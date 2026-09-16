import cv2
import numpy as np
from PIL import Image

def enhance_contrast_clahe(img_np):
    """Enhance local contrast in LAB color space to make colored text pop against backgrounds"""
    if len(img_np.shape) == 2:
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        return clahe.apply(img_np)
    
    lab = cv2.cvtColor(img_np, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl, a, b))
    return cv2.cvtColor(limg, cv2.COLOR_LAB2RGB)

def estimate_rotation_angle(crop_np):
    """Estimate the orientation angle of text in degrees (-45 to +45) using minAreaRect"""
    if len(crop_np.shape) == 3:
        gray = cv2.cvtColor(crop_np, cv2.COLOR_RGB2GRAY)
    else:
        gray = crop_np
        
    # Contrast enhancement
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    
    # Gradient / Edge detection
    grad_x = cv2.Sobel(enhanced, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(enhanced, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(grad_x, grad_y)
    norm_mag = cv2.normalize(mag, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    
    # Threshold edges
    _, thresh = cv2.threshold(norm_mag, 50, 255, cv2.THRESH_BINARY)
    
    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    angles = []
    for cnt in contours:
        if cv2.contourArea(cnt) > 40:
            rect = cv2.minAreaRect(cnt)
            w_box, h_box = rect[1]
            angle = rect[2]
            
            # minAreaRect returns angle in [-90, 0] or [0, 90]
            if w_box < h_box:
                angle = angle + 90 if angle < 0 else angle - 90
            if -45 <= angle <= 45:
                angles.append(angle)
                
    if len(angles) > 3:
        median_angle = float(np.median(angles))
        if abs(median_angle) > 2.5:
            return round(median_angle, 1)
            
    return 0.0

def deskew_crop(crop_pil, angle):
    """Rotate crop to 0 degrees using high-quality bicubic interpolation"""
    if abs(angle) < 2.0:
        return crop_pil
    return crop_pil.rotate(-angle, resample=Image.BICUBIC, expand=True)
