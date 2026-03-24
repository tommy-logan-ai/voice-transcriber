export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': req.headers['content-type'],
    },
    body,
  });

  const data = await response.json();
  res.status(response.status).json(data);
}

export const config = {
  api: { bodyParser: false },
};
```

Commit that. Then go to **github.com/tommy-logan-ai/voice-transcriber/blob/main/src/App.jsx**, find line 116 which says:
```
headers: { Authorization: `Bearer ${apiKey}` },
