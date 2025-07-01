// ImageStream.js
import React, { useEffect, useRef } from 'react';

const ImageStream = () => {
    const canvasRef = useRef(null);

    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8080');
        ws.binaryType = 'arraybuffer';  // Ensure WebSocket receives binary data

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        let width = 640;
        let height = 480;

        ws.onmessage = (event) => {
            const imageBytes = new Uint8Array(event.data);

            // Clear canvas before drawing new frame
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Check if canvas size needs adjustment
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }

            const imageData = ctx.createImageData(width, height);
            const data = imageData.data;

            for (let i = 0, j = 0; i < imageBytes.length; i += 3, j += 4) {
                data[j] = imageBytes[i + 2];     // R
                data[j + 1] = imageBytes[i + 1]; // G
                data[j + 2] = imageBytes[i];     // B
                data[j + 3] = 255;               // A (full opacity)
            }

            ctx.putImageData(imageData, 0, 0);
        };

        return () => {
            ws.close();
        };
    }, []);

    return (
        <div>
            <h2>Image Stream</h2>
            <canvas ref={canvasRef}></canvas>
        </div>
    );
};

export default ImageStream;
