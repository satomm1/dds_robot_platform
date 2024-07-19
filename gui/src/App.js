// src/App.js
import React, { useEffect, useState } from 'react';

function App() {
    const [messages, setMessages] = useState([]);

    useEffect(() => {
        const websocket = new WebSocket('ws://localhost:8765');

        websocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setMessages((prevMessages) => [...prevMessages, data]);
            console.log('Received data:', data);
        };

        return () => websocket.close();
    }, []);

    return (
        <div>
            <h1>WebSocket Messages</h1>
            <ul>
                {messages.map((message, index) => (
                    <li key={index}>{JSON.stringify(message)}</li>
                ))}
            </ul>
        </div>
    );
}

export default App;
