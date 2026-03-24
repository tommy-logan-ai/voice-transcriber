import { IncomingForm } from 'formidable';
import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const form = new IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: err.message });

    try {
      const file = files.file[0];
      const formData = new FormData();
      formData.append('file', fs.createReadStream(file.filepath), file.originalFilename);
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'verbose_json');
      formData.append('timestamp_granularities[]', 'segment');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': req.headers['authorization'],
          ...formData.getHeaders(),
        },
        body: formData,
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
