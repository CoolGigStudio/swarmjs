const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'voice-qa.html'));
});

app.listen(port, () => {
  console.log(`🌐 Voice Q&A server running at http://localhost:${port}`);
  console.log('📱 Open this URL in your browser to test the voice interface');
});