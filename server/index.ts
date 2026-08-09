import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { savePngToContentFolder, generateUefnPythonImportScript } from './textureImporter';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer memory storage for direct PNG uploads
const upload = multer({ storage: multer.memoryStorage() });

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', server: 'UEFN Entitlement Manager Bridge', version: '1.0.0' });
});

// Scan directory for existing Verse files and folders
app.post('/api/project/scan', (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || !fs.existsSync(folderPath)) {
      return res.status(400).json({ success: false, error: 'Directory does not exist' });
    }

    const files = fs.readdirSync(folderPath);
    const verseFiles = files.filter(f => f.toLowerCase().endsWith('.verse'));
    const subDirs = files.filter(f => {
      try {
        return fs.statSync(path.join(folderPath, f)).isDirectory();
      } catch {
        return false;
      }
    });

    const hasInIslandTransactions = verseFiles.some(f => f.toLowerCase() === 'in_island_transactions.verse');

    res.json({
      success: true,
      folderPath,
      verseFiles,
      subDirs,
      hasInIslandTransactions,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to scan project' });
  }
});

// Load Verse file content
app.post('/api/verse/load', (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Verse file not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ success: true, content, filePath });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to read Verse file' });
  }
});

// Save Verse file content with automatic backup
app.post('/api/verse/save', (req, res) => {
  try {
    const { filePath, content, createBackup = true } = req.body;
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Target file path is required' });
    }

    const targetDir = path.dirname(filePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Create timestamped backup if file already exists
    if (createBackup && fs.existsSync(filePath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(targetDir, '.backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupPath = path.join(backupDir, `${path.basename(filePath)}.${timestamp}.bak`);
      fs.copyFileSync(filePath, backupPath);
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true, filePath, message: 'Verse file written successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to save Verse file' });
  }
});

// Upload PNG texture asset to dedicated public folder
app.post('/api/texture/upload', upload.single('image'), (req, res) => {
  try {
    const { contentFolderPath, assetFolderName = 'EntitlementIcons', assetName } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false, error: 'No image file uploaded' });
    }
    if (!contentFolderPath) {
      return res.status(400).json({ success: false, error: 'Content folder path is required' });
    }

    const cleanAssetName = assetName || path.parse(file.originalname).name;
    const result = savePngToContentFolder(
      contentFolderPath,
      assetFolderName,
      cleanAssetName,
      file.buffer
    );

    // Also write a python helper script in the project content directory
    const pythonScript = generateUefnPythonImportScript(contentFolderPath, assetFolderName);
    const pythonScriptPath = path.join(contentFolderPath, assetFolderName, 'import_icons.py');
    try {
      fs.writeFileSync(pythonScriptPath, pythonScript, 'utf-8');
    } catch {
      // Ignore helper write error if restricted
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to upload texture' });
  }
});

// Trigger Verse compilation via Verse Workflow Server on TCP 1962
app.post('/api/verse/compile', async (req, res) => {
  const host = '127.0.0.1';
  const port = 1962;

  const client = new net.Socket();
  let responseData = '';
  let isFinished = false;

  const timeout = setTimeout(() => {
    if (!isFinished) {
      isFinished = true;
      client.destroy();
      res.json({
        success: false,
        connected: false,
        error: 'Verse Workflow Server timeout (UEFN editor may not be running on port 1962)',
      });
    }
  }, 4000);

  client.connect(port, host, () => {
    const jsonMessage = JSON.stringify({ seq: 1, type: 1, command: 'compileProject', params: {} });
    const byteLength = Buffer.byteLength(jsonMessage, 'utf-8');
    const packet = `Content-Length: ${byteLength}\r\n\r\n${jsonMessage}`;
    client.write(packet);
  });

  client.on('data', (data) => {
    responseData += data.toString('utf-8');
    if (responseData.includes('"type"') && responseData.includes('"compileProject"')) {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timeout);
        client.destroy();
        res.json({
          success: true,
          connected: true,
          rawResponse: responseData,
          message: 'Verse compilation triggered successfully',
        });
      }
    }
  });

  client.on('error', (err) => {
    if (!isFinished) {
      isFinished = true;
      clearTimeout(timeout);
      client.destroy();
      res.json({
        success: false,
        connected: false,
        error: `Could not connect to Verse Workflow Server on port 1962: ${err.message}`,
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`[UEFN Entitlement Manager Bridge] Server listening on http://localhost:${PORT}`);
});
