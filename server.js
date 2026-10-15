const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

// Serve static files from the root directory
app.use(express.static(__dirname));

// For JS files that weren't found, return 404 instead of index.html
app.get('*.js', (req, res) => {
  res.status(404).send('Not found');
});

// Send index.html for any other requests (useful for SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
