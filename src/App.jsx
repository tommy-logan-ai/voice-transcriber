import { useState, useRef, useCallback } from "react";

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function speakerColor(index) {
  const palette = ["#62B1BD", "#009BDF", "#F4A261", "#E76F51", "#A8DADC", "#457B9D"];
  return palette[index % palette.length];
}

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [keyConfirmed, setKeyConfirmed] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [numSpeakers, setNumSpeakers] = useState(2);
  const [memoType, setMemoType] = useState("client");
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState("");
  const [transcript, setTranscript] = useState(null);
  const [speakers, setSpeakers] = useState({});
  const [summary, setSummary] = useState("");
  const [actionItems, setActionItems] = useState([]);
  const [loganPacket, setLoganPacket] = useState(null);
  const [activeTab, setActiveTab] = useState("transcript");
  const [error, setError] = useState("");
  const fileRef = useRef();

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, []);

  const loadFile = (file) => {
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setStage("idle");
    setTranscript(null);
    setSummary("");
    setActionItems([]);
    setLoganPacket(null);
    setError("");
  };

  const transcribe = async () => {
    if (!audioFile || !apiKey) return;
    try {
      setStage("transcribing");
      setProgress("Sending audio to Whisper...");
      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Whisper API error");
      }
      const data = await res.json();
      setProgress("Transcription complete. Analyzing speakers...");
      await analyzeSpeakers(data);
    } catch (e) {
      setStage("error");
      setError(e.message);
    }
  };

  const analyzeSpeakers = async (whisperData) => {
    setStage("analyzing");
    const rawText = whisperData.segments
      .map((s) => `[${formatTime(s.start)}] ${s.text.trim()}`)
      .join("\n");

    const systemPrompt = `You are an expert conversation analyst for a real estate and mortgage professional named Tommy.
Your job is to:
1. Analyze a transcript and assign speaker labels (Speaker_0, Speaker_1, etc.) to each segment based on conversational cues. Use up to ${numSpeakers} speakers.
2. Write a concise summary (3-5 sentences) tailored to a ${memoType} context.
3. Extract clear action items as a JSON array of strings.
4. Return ONLY valid JSON in this exact shape:
{
  "segments": [{"start": 0, "end": 5, "speaker": "Speaker_0", "text": "..."}],
  "speakerGuesses": {"Speaker_0": "Tommy (likely)", "Speaker_1": "Client"},
  "summary": "...",
  "actionItems": ["...", "..."]
}
Do not include any markdown, code fences, or explanation. Pure JSON only.`;

    const userPrompt = `Memo type: ${memoType}
Number of speakers: ${numSpeakers}
Raw transcript segments:
${rawText}
Original whisper data for timing reference:
${JSON.stringify(whisperData.segments.map(s => ({ start: s.start, end: s.end, text: s.text })))}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    const data = await res.json();
    const raw = data.content?.find(b => b.type === "text")?.text || "";
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      throw new Error("Claude returned invalid JSON. Try again.");
    }

    setTranscript(parsed.segments);
    setSpeakers(parsed.speakerGuesses || {});
    setSummary(parsed.summary || "");
    setActionItems(parsed.actionItems || []);
    setLoganPacket({
      source: "voice_memo",
      file: audioFile.name,
      memo_type: memoType,
      timestamp: new Date().toISOString(),
      summary: parsed.summary,
      action_items: parsed.actionItems,
      speakers: parsed.speakerGuesses,
      transcript: parsed.segments,
    });
    setStage("done");
    setActiveTab("transcript");
    setProgress("");
  };

  const renameSpeaker = (key, newName) => {
    setSpeakers((prev) => ({ ...prev, [key]: newName }));
  };

  const speakerIndex = {};
  Object.keys(speakers).forEach((k, i) => { speakerIndex[k] = i; });

  const copyTranscript = () => {
    const text = transcript
      .map(s => `[${formatTime(s.start)}] ${speakers[s.speaker] || s.speaker}: ${s.text}`)
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  const copyLoganPacket = () => {
    navigator.clipboard.writeText(JSON.stringify(loganPacket, null, 2));
  };

  const downloadTranscript = () => {
    const text = [
      `TRANSCRIPT — ${audioFile?.name}`,
      `Date: ${new Date().toLocaleString()}`,
      `Type: ${memoType}`,
      ``,
      `SUMMARY`,
      summary,
      ``,
      `ACTION ITEMS`,
      ...actionItems.map((a, i) => `${i + 1}. ${a}`),
      ``,
      `FULL TRANSCRIPT`,
      ...transcript.map(s => `[${formatTime(s.start)}] ${speakers[s.speaker] || s.speaker}: ${s.text}`),
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `transcript-${Date.now()}.txt`;
    a.click();
  };

  const speakerKeys = Object.keys(speakers);

  const S = {
    app: { minHeight: "100vh", background: "linear-gradient(135deg, #231F20 0%, #1a2a35 60%, #185A7D 100%)", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: "#fff" },
    header: { background: "linear-gradient(90deg, #185A7D, #231F20)", borderBottom: "2px solid #62B1BD", padding: "18px 32px", display: "flex", alignItems: "center", gap: "14px" },
    container: { maxWidth: "900px", margin: "0 auto", padding: "28px 24px" },
    card: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(98,177,189,0.2)", borderRadius: "14px", padding: "24px", marginBottom: "20px" },
    label: { fontSize: "11px", fontWeight: "700", letterSpacing: "2px", textTransform: "uppercase", color: "#62B1BD", marginBottom: "8px", display: "block" },
    input: { width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(98,177,189,0.3)", borderRadius: "8px", padding: "12px 14px", color: "#fff", fontSize: "14px", outline: "none", boxSizing: "border-box" },
    dropZone: { border: "2px dashed #62B1BD", borderRadius: "12px", padding: "40px 24px", textAlign: "center", cursor: "pointer", background: "rgba(98,177,189,0.04)" },
    btn: (c = "#62B1BD") => ({ background: c, color: "#231F20", border: "none", borderRadius: "8px", padding: "12px 24px", fontWeight: "700", fontSize: "14px", cursor: "pointer" }),
    btnGhost: { background: "transparent", color: "#62B1BD", border: "1px solid #62B1BD", borderRadius: "8px", padding: "9px 18px", fontWeight: "600", fontSize: "13px", cursor: "pointer" },
    tab: (a) => ({ padding: "10px 20px", borderRadius: "8px 8px 0 0", fontWeight: "700", fontSize: "13px", cursor: "pointer", background: a ? "#62B1BD" : "transparent", color: a ? "#231F20" : "#aaa", border: "none" }),
    spinner: { width: "16px", height: "16px", border: "2px solid #62B1BD", borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 },
  };

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fi { animation: fadeIn 0.4s ease; }
        input::placeholder { color: #555; }
        select option { background: #1a2a35; }
      `}</style>

      <div style={S.header}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: "800", letterSpacing: "3px", color: "#62B1BD" }}>REALTEAM</div>
          <div style={{ fontSize: "10px", color: "#aaa", letterSpacing: "2px" }}>Real Estate</div>
        </div>
        <div style={{ width: "1px", height: "36px", background: "rgba(98,177,189,0.3)", margin: "0 8px" }} />
        <div style={{ fontSize: "22px" }}>🎙️</div>
        <div style={{ fontSize: "20px", fontWeight: "700", marginLeft: "auto" }}>Voice Memo Transcriber</div>
      </div>

      <div style={S.container}>
        {!keyConfirmed && (
          <div style={S.card} className="fi">
            <span style={S.label}>OpenAI API Key (Whisper)</span>
            <div style={{ display: "flex", gap: "10px" }}>
              <input style={S.input} type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} onKeyDown={e => e.key === "Enter" && apiKey.startsWith("sk-") && setKeyConfirmed(true)} />
              <button style={S.btn()} onClick={() => apiKey.startsWith("sk-") && setKeyConfirmed(true)}>Confirm</button>
            </div>
            <p style={{ fontSize: "12px", color: "#888", marginTop: "10px" }}>Your key stays in your browser only. Never stored or sent anywhere else. Get one at platform.openai.com</p>
          </div>
        )}

        {keyConfirmed && (
          <>
            <div style={{ ...S.card, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }} className="fi">
              <div>
                <span style={S.label}>Memo Type</span>
                <select style={{ ...S.input, cursor: "pointer" }} value={memoType} onChange={e => setMemoType(e.target.value)}>
                  <option value="client">Client Call – Real Estate</option>
                  <option value="mortgage">Mortgage Conversation</option>
                  <option value="team">Team Meeting</option>
                  <option value="personal">Personal Note / Idea</option>
                </select>
              </div>
              <div>
                <span style={S.label}>Expected Speakers</span>
                <select style={{ ...S.input, cursor: "pointer" }} value={numSpeakers} onChange={e => setNumSpeakers(Number(e.target.value))}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} {n === 1 ? "speaker" : "speakers"}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button style={{ ...S.btnGhost, fontSize: "12px" }} onClick={() => setKeyConfirmed(false)}>🔑 Change Key</button>
              </div>
            </div>

            <div style={S.card} className="fi" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
              <div style={S.dropZone} onClick={() => fileRef.current.click()}>
                <div style={{ fontSize: "40px", marginBottom: "10px" }}>🎤</div>
                <div style={{ fontWeight: "700", fontSize: "16px", color: "#62B1BD" }}>Drop your voice memo here</div>
                <div style={{ color: "#888", fontSize: "13px", marginTop: "6px" }}>or click to browse — .m4a .mp3 .mp4 .wav .ogg</div>
                {audioFile && (
                  <div style={{ marginTop: "14px", padding: "8px 16px", background: "rgba(98,177,189,0.1)", borderRadius: "8px", display: "inline-block", color: "#62B1BD", fontSize: "13px", fontWeight: "600" }}>
                    📎 {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)} MB)
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".m4a,.mp3,.mp4,.wav,.ogg,.webm" style={{ display: "none" }} onChange={e => e.target.files[0] && loadFile(e.target.files[0])} />
              {audioUrl && <audio controls src={audioUrl} style={{ width: "100%", marginTop: "14px", borderRadius: "8px" }} />}
            </div>

            {audioFile && stage !== "done" && (
              <div style={{ textAlign: "center", marginBottom: "20px" }}>
                {(stage === "transcribing" || stage === "analyzing") ? (
                  <div style={{ background: "rgba(98,177,189,0.15)", border: "1px solid #62B1BD", borderRadius: "24px", padding: "10px 20px", fontSize: "13px", color: "#62B1BD", display: "inline-flex", alignItems: "center", gap: "10px" }}>
                    <div style={S.spinner} />{progress || "Processing..."}
                  </div>
                ) : (
                  <button style={{ ...S.btn(), fontSize: "16px", padding: "14px 40px" }} onClick={transcribe}>🚀 Transcribe + Analyze</button>
                )}
              </div>
            )}

            {stage === "error" && (
              <div style={{ ...S.card, border: "1px solid #e76f51", color: "#e76f51" }}>
                ⚠️ {error}
                <button style={{ ...S.btnGhost, marginLeft: "16px", borderColor: "#e76f51", color: "#e76f51" }} onClick={() => setStage("idle")}>Retry</button>
              </div>
            )}

            {stage === "done" && transcript && (
              <div className="fi">
                {speakerKeys.length > 0 && (
                  <div style={{ ...S.card, marginBottom: "16px" }}>
                    <span style={S.label}>Name Your Speakers</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                      {speakerKeys.map((key, i) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: speakerColor(i), fontWeight: "700", fontSize: "12px", minWidth: "70px" }}>{key}</span>
                          <input style={{ ...S.input, width: "160px", padding: "8px 12px", fontSize: "13px" }} value={speakers[key]} onChange={e => renameSpeaker(key, e.target.value)} placeholder="Enter name..." />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: "4px", marginBottom: "-1px" }}>
                  {["transcript","summary","actions","logan"].map(tab => (
                    <button key={tab} style={S.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>
                      {{"transcript":"📄 Transcript","summary":"✨ Summary","actions":"✅ Actions","logan":"🤖 Logan"}[tab]}
                    </button>
                  ))}
                </div>

                <div style={S.card}>
                  {activeTab === "transcript" && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                        <span style={{ ...S.label, margin: 0 }}>Full Transcript</span>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button style={S.btnGhost} onClick={copyTranscript}>📋 Copy</button>
                          <button style={S.btnGhost} onClick={downloadTranscript}>⬇️ Download</button>
                        </div>
                      </div>
                      {transcript.map((seg, i) => (
                        <div key={i} style={{ display: "flex", gap: "14px", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", alignItems: "flex-start" }}>
                          <span style={{ fontSize: "10px", color: "#666", minWidth: "44px", paddingTop: "3px" }}>{formatTime(seg.start)}</span>
                          <span style={{ minWidth: "110px", fontSize: "11px", fontWeight: "700", color: speakerColor(speakerIndex[seg.speaker] ?? 0), letterSpacing: "0.5px", paddingTop: "2px" }}>{speakers[seg.speaker] || seg.speaker}</span>
                          <span style={{ fontSize: "14px", lineHeight: "1.6", color: "#e8e8e8" }}>{seg.text}</span>
                        </div>
                      ))}
                    </>
                  )}

                  {activeTab === "summary" && (
                    <>
                      <span style={S.label}>AI Summary</span>
                      <p style={{ fontSize: "15px", lineHeight: "1.8", color: "#ddd" }}>{summary}</p>
                      <button style={{ ...S.btnGhost, marginTop: "16px" }} onClick={() => navigator.clipboard.writeText(summary)}>📋 Copy Summary</button>
                    </>
                  )}

                  {activeTab === "actions" && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                        <span style={{ ...S.label, margin: 0 }}>Action Items</span>
                        <button style={S.btnGhost} onClick={() => navigator.clipboard.writeText(actionItems.map((a,i) => `${i+1}. ${a}`).join("\n"))}>📋 Copy All</button>
                      </div>
                      {actionItems.length === 0 && <p style={{ color: "#888" }}>No action items detected.</p>}
                      {actionItems.map((item, i) => (
                        <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <input type="checkbox" style={{ width: "18px", height: "18px", accentColor: "#62B1BD", marginTop: "2px", cursor: "pointer" }} />
                          <span style={{ fontSize: "14px", lineHeight: "1.6", color: "#e8e8e8" }}>{item}</span>
                        </div>
                      ))}
                    </>
                  )}

                  {activeTab === "logan" && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                        <span style={{ ...S.label, margin: 0 }}>Logan JSON Packet</span>
                        <button style={S.btnGhost} onClick={copyLoganPacket}>📋 Copy JSON</button>
                      </div>
                      <p style={{ fontSize: "12px", color: "#888", marginBottom: "12px" }}>Paste directly into Logan's memory layer or POST to Logan's API endpoint.</p>
                      <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid #009BDF", borderRadius: "10px", padding: "16px", fontFamily: "monospace", fontSize: "12px", color: "#a8d8e0", whiteSpace: "pre-wrap", maxHeight: "320px", overflow: "auto" }}>
                        {JSON.stringify(loganPacket, null, 2)}
                      </div>
                    </>
                  )}
                </div>

                <div style={{ textAlign: "center", marginTop: "16px" }}>
                  <button style={S.btnGhost} onClick={() => { setStage("idle"); setTranscript(null); setAudioFile(null); setAudioUrl(null); }}>🔄 New Memo</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
