export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const url = req.headers['x-target-url'];

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const headers = {
    'Content-Type': req.headers['content-type'],
  };

  if (url.includes('openai')) {
    headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
  } else if (url.includes('anthropic')) {
    headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
    headers['anthropic-version'] = '2023-06-01';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  const data = await response.json();
  res.status(response.status).json(data);
}

export const config = {
  api: { bodyParser: false, sizeLimit: '25mb' },
};
