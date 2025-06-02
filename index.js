
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const Jimp = require('jimp');

const bodyParser = require('body-parser');



const app = express();
const port = 3000;

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// Serve static files
app.use(express.static(__dirname));

app.use('/edited_frames', express.static(path.join(__dirname, 'edited_frames')));

app.use('/final_video', express.static(path.join(__dirname, 'final_video')));

app.use('/masks', express.static(path.join(__dirname, 'masks')));


app.use(bodyParser.json({ limit: '10mb' }));



// ➡️ ADD THIS LINE to serve frames folder:
app.use('/frames', express.static(path.join(__dirname, 'frames')));

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Upload and extract frames
app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    console.log('No file uploaded.');
    return res.status(400).send('No video file uploaded.');
  }

  const videoPath = path.join(__dirname, 'uploads', req.file.filename);
  const framesDir = path.join(__dirname, 'frames');

  if (!fs.existsSync(framesDir)) {
    fs.mkdirSync(framesDir);
  }

  const outputPattern = path.join(framesDir, 'frame-%03d.png');
  const command = `ffmpeg -y -i "${videoPath}" "${outputPattern}"`;

  console.log('Running ffmpeg command:', command);

  exec(command, (error, stdout, stderr) => {
    console.log('========= FFMPEG DEBUG OUTPUT =========');
    console.log('STDOUT:', stdout);
    console.log('STDERR:', stderr);
    console.log('========================================');

    if (error) {
      console.error('ERROR from ffmpeg:', error);
      return res.status(500).send('Error extracting frames.');
    }

    console.log('Frames extracted successfully.');
    res.status(200).send(`Video uploaded and frames extracted successfully: ${req.file.filename}`);
  });
});

// Serve list of frames
app.get('/frames', (req, res) => {
  const framesDir = path.join(__dirname, 'frames');

  fs.readdir(framesDir, (err, files) => {
    if (err) {
      console.error('Error reading frames directory:', err);
      return res.status(500).json({ error: 'Failed to load frames.' });
    }

    const frameFiles = files.filter(file => file.endsWith('.png'));
    res.json(frameFiles);
  });
});

// Blur all frames
app.get('/blur-frames', async (req, res) => {
  const inputDir = path.join(__dirname, 'frames');
  const outputDir = path.join(__dirname, 'edited_frames');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  try {
    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.png'));

    if (files.length === 0) {
      console.log('⚠️ No PNG files found in frames folder.');
      return res.status(404).send('No frames found to blur.');
    }

    console.log(`🟢 Found ${files.length} frames. Starting blur...`);

    for (const file of files) {
      const inputPath = path.join(inputDir, file);
      const outputPath = path.join(outputDir, file);

      console.log(`👉 Blurring: ${file}`);

      const image = await Jimp.read(inputPath);
      image.blur(10);
      await image.writeAsync(outputPath);

      console.log(`✅ Saved blurred: ${outputPath}`);
    }

    res.status(200).json({ message: '✅ All frames blurred and saved to /edited_frames!' });

  } catch (error) {
    console.error('❌ Blur Error:', error);
    res.status(500).json({ error: '❌ Failed to blur frames.' });

  }
});

app.post('/save-mask', (req, res) => {
  const { imageData, fileName } = req.body;

  if (!imageData || !fileName) {
    return res.status(400).send('Missing imageData or fileName');
  }

  const buffer = Buffer.from(imageData.replace(/^data:image\/png;base64,/, ''), 'base64');
  const savePath = path.join(__dirname, 'masks', fileName);

  fs.writeFile(savePath, buffer, (err) => {
    if (err) {
      console.error('❌ Failed to save mask:', err);
      return res.status(500).send('Failed to save mask');
    }
    console.log(`✅ Mask saved: ${fileName}`);
    res.status(200).send('Mask saved successfully');
  });
});


// Rebuild video from blurred frames
app.get('/build-video', (req, res) => {
  const outputDir = path.join(__dirname, 'final_video');
  const inputPattern = path.join(__dirname, 'edited_frames', 'frame-%03d.png');
  const outputVideo = path.join(outputDir, 'final.mp4');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  // FFmpeg command: make video from images (25 FPS)
  const command = `ffmpeg -y -framerate 25 -i "${inputPattern}" -c:v libx264 -pix_fmt yuv420p "${outputVideo}"`;

  console.log('▶️ Rebuilding video...');
  exec(command, (error, stdout, stderr) => {
    console.log('FFmpeg OUTPUT:', stdout);
    console.log('FFmpeg ERRORS:', stderr);

    if (error) {
      console.error('❌ Error creating video:', error);
      return res.status(500).send('Error creating video');
    }

    console.log('✅ Final video created at:', outputVideo);
    res.send('✅ Final video has been built successfully! <br><br><a href="/final_video/final.mp4" download>⬇️ Download Final Video</a>');
  });
});

app.get('/run-inpaint', (req, res) => {
  const command = `python3 inpaint_frames.py`;
  const outputDir = path.join(__dirname, 'final_video');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Inpainting error:', error);
      return res.status(500).send('❌ Inpainting failed.');
    }

    console.log('✅ Inpainting complete.');
    console.log('STDOUT:', stdout);
    console.log('STDERR:', stderr);

    // Rebuild final video from edited frames
    const buildCmd = `./bin/ffmpeg -y -framerate 25 -i edited_frames/frame-%03d.png -c:v libx264 -pix_fmt yuv420p final_video/final.mp4`;


    exec(buildCmd, (err) => {
      if (err) {
        console.error('Build video error:', err);
        return res.status(500).send('✅ Inpainting done, but failed to build video.');
      }

      console.log('🎬 Final video created.');

      // Send preview + download
      res.send(`
        ✅ Final video is ready!<br><br>
        <a href="/final_video/final.mp4" download>⬇️ Download Final Video</a><br><br>
        <video width="640" controls>
          <source src="/final_video/final.mp4" type="video/mp4">
        </video>
      `);
    });
  });
});

// app.get('/run-inpaint', (req, res) => {
//   const command = `python3 inpaint_frames.py`;


//   console.log('🧠 Running inpaint_frames.py...');

//   exec(command, (error, stdout, stderr) => {
//     console.log('STDOUT:', stdout);
//     console.log('STDERR:', stderr);

//     if (error) {
//       console.error('❌ Inpainting error:', error);
//       return res.status(500).send('❌ Inpainting failed.\n\n' + stderr);
//     }

//     console.log('✅ Inpainting complete!');
//     res.send('✅ Inpainting complete! Check /edited_frames.');
//   });
// });


app.get('/apply-mask-to-all', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  const masksDir = path.join(__dirname, 'masks');
  const framesDir = path.join(__dirname, 'frames');
  const sourceMask = path.join(masksDir, 'frame-001.png'); // the one you drew manually

  if (!fs.existsSync(sourceMask)) {
    return res.status(400).send('❌ Source mask (frame-001.png) not found.');
  }

  fs.readdir(framesDir, (err, files) => {
    if (err) return res.status(500).send('❌ Failed to read frames.');

    const frameFiles = files.filter(f => f.endsWith('.png'));

    frameFiles.forEach((frame) => {
      const dest = path.join(masksDir, frame);
      fs.copyFileSync(sourceMask, dest);
    });

    console.log(`📤 Mask from frame-001.png copied to ${frameFiles.length} frames.`);
    res.send(`✅ Applied mask from frame-001.png to ${frameFiles.length} frames.`);
  });
});


// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});



