
import cv2
import os

frames_dir = 'frames'
masks_dir = 'masks'
output_dir = 'edited_frames'

# Create output directory if it doesn't exist
if not os.path.exists(output_dir):
    os.makedirs(output_dir)

# Get all frame file names
frame_files = sorted([f for f in os.listdir(frames_dir) if f.endswith('.jpg') or f.endswith('.png')])

for frame_file in frame_files:
    frame_path = os.path.join(frames_dir, frame_file)
    mask_path = os.path.join(masks_dir, frame_file)  # mask should have same name

    if not os.path.exists(mask_path):
        print(f" Mask not found for frame: {frame_file}, skipping.")
        continue

    # Load images
    frame = cv2.imread(frame_path)
    mask = cv2.imread(mask_path, cv2.IMREAD_GRAYSCALE)  # grayscale mask

    # Inpaint the text area using Telea method
    inpainted = cv2.inpaint(frame, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    # Save the result
    output_path = os.path.join(output_dir, frame_file)
    cv2.imwrite(output_path, inpainted)
    print(f"Inpainted frame saved: {output_path}")



print(" All frames processed with inpainting!")
