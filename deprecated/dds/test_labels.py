import os
import numpy as np
import cv2

# Load the image and labels

image_num = 5

image_path = f"new_data/images/new_image_{image_num}.jpg"
image = cv2.imread(image_path)

label_path = f"new_data/labels/new_image_{image_num}.txt"
with open(label_path, 'r') as f:
    lines = f.readlines()
labels = [line.strip().split() for line in lines]

# Draw the bounding boxes and labels on the image
for label in labels:
    class_name, x, y, w, h = label
    x1 = int((float(x) - float(w) / 2) * image.shape[1])
    y1 = int((float(y) - float(h) / 2) * image.shape[0])
    x2 = int((float(x) + float(w) / 2) * image.shape[1])
    y2 = int((float(y) + float(h) / 2) * image.shape[0])
    
    # Draw the bounding box
    cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 2)
    
    # Put the label on top of the bounding box
    cv2.putText(image, class_name, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

# Save the image
output_path = "sample_img.jpg"
cv2.imwrite(output_path, image)
