import React, { useState, useRef, useEffect } from 'react';
import { Upload, Play, Download, Settings, FileText, CheckCircle, AlertCircle, Loader2, Save } from 'lucide-react';
import JSZip from 'jszip'; 
import { TTSConfig, ProcessingLog, AppStatus } from './types';
import { readFileAsText, parseTextBlocks, maskApiKey } from './services/utils';
import { generateVoice, createZip, fetchUserSubscription } from './services/elevenLabsService';
import { SliderControl, SelectControl } from './components/SettingsControl';

const DEFAULT_CONFIG: TTSConfig = {
  modelId: 'eleven_multilingual_v2',
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
  speed: 1.0,
  outputFormat: 'mp3_44100_128',
  latency: 0,
};

const MODELS = [
  { label: 'eleven_multilingual_v2 (Best for narration)', value: 'eleven_multilingual_v2' },
  { label: 'eleven_flash_v2 (Fast/Cheap)', value: 'eleven_flash_v2' },
  { label: 'eleven_turbo_v2 (Low latency)', value: 'eleven_turbo_v2' },
  { label: 'eleven_flash_v2_5 (Newer Flash)', value: 'eleven_flash_v2_5' },
  { label: 'eleven_turbo_v2_5 (Newer Turbo)', value: 'eleven_turbo_v2_5' },
  { label: 'eleven_v3 (Alpha)', value: 'eleven_v3' },
];

const OUTPUT_FORMATS = [
  { label: 'mp3_44100_128 (Default)', value: 'mp3_44100_128' },
  { label: 'mp3_22050_32 (Small)', value: 'mp3_22050_32' },
  { label: 'pcm_16000 (WAV/PCM)', value: 'pcm_16000' },
];

const LATENCY_OPTS = [
  { label: '0 (Quality)', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4 (Fastest)', value: 4 },
];

export default function App() {
  const [config, setConfig] = useState<TTSConfig>(DEFAULT_CONFIG);
  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [voiceId, setVoiceId] = useState<string>('');
  const [rawText, setRawText] = useState<string>('');
  const [logs, setLogs] = useState<ProcessingLog[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [progress, setProgress] = useState(0);

  const isV3 = config.modelId === 'eleven_v3';

  // File names for display
  const [filesLoaded, setFilesLoaded] = useState({
    api: '',
    voice: '',
    text: ''
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'api' | 'voice' | 'text') => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await readFileAsText(file);
      if (type === 'api') {
        const keys = content.split('\n').map(k => k.trim()).filter(k => k.length > 0);
        setApiKeys(keys);
        setFilesLoaded(prev => ({ ...prev, api: file.name }));
      } else if (type === 'voice') {
        setVoiceId(content.trim());
        setFilesLoaded(prev => ({ ...prev, voice: file.name }));
      } else if (type === 'text') {
        setRawText(content);
        setFilesLoaded(prev => ({ ...prev, text: file.name }));
      }
    } catch (err) {
      alert('Failed to read file');
    }
  };

  const runBatch = async () => {
    if (apiKeys.length === 0 || !voiceId || !rawText) {
      alert('Please upload all required files (API Keys, Voice ID, Texts).');
      return;
    }

    setStatus(AppStatus.PROCESSING);
    setLogs([]);
    const blocks = parseTextBlocks(rawText);
    
    if (blocks.length === 0) {
        alert("No valid text blocks found. Ensure format matches '1. Title \\n content'");
        setStatus(AppStatus.IDLE);
        return;
    }

    const newLogs: ProcessingLog[] = blocks.map((text, idx) => ({
      id: idx,
      textSnippet: text.substring(0, 60).replace(/\n/g, ' ') + (text.length > 60 ? '...' : ''),
      status: 'pending',
    }));
    setLogs(newLogs);

    let currentKeyIdx = 0;
    const successfulBlobs: { name: string; blob: Blob }[] = [];

    console.log("Checking keys..."); 
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      setLogs(prev => prev.map(log => log.id === i ? { ...log, status: 'processing' } : log));

      let success = false;
      let attempts = 0;
      
      while (!success && attempts < apiKeys.length) {
        const key = apiKeys[currentKeyIdx % apiKeys.length];
        currentKeyIdx++; 
        attempts++;

        const result = await generateVoice(block, key, voiceId, config);

        if (result.success && result.data) {
          const url = URL.createObjectURL(result.data);
          successfulBlobs.push({ name: `Block_${i + 1}.mp3`, blob: result.data });
          
          setLogs(prev => prev.map(log => log.id === i ? { 
            ...log, 
            status: 'success', 
            audioUrl: url, 
            audioBlob: result.data,
            apiKeyUsed: maskApiKey(key) 
          } : log));
          success = true;
        } else {
           console.warn(`Failed with key ${maskApiKey(key)}: ${result.error}`);
        }
        
        await new Promise(r => setTimeout(r, 500));
      }

      if (!success) {
        setLogs(prev => prev.map(log => log.id === i ? { ...log, status: 'error', message: 'All keys failed' } : log));
      }
      
      setProgress(Math.round(((i + 1) / blocks.length) * 100));
    }

    setStatus(AppStatus.COMPLETED);

    if (successfulBlobs.length > 0) {
      try {
        const zipBlob = await createZip(successfulBlobs);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'eleven_gen_voices.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (e) {
        console.error("Zip failed", e);
      }
    }
  };

  const downloadSingle = (blob: Blob, index: number) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Block_${index + 1}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const downloadAllZip = async () => {
     const blobs = logs
        .filter(l => l.status === 'success' && l.audioBlob)
        .map(l => ({ name: `Block_${l.id + 1}.mp3`, blob: l.audioBlob! }));
     
     if (blobs.length === 0) return;

     const zipBlob = await createZip(blobs);
     const url = URL.createObjectURL(zipBlob);
     const a = document.createElement('a');
     a.href = url;
     a.download = 'eleven_gen_voices.zip';
     document.body.appendChild(a);
     a.click();
     document.body.removeChild(a);
  };

  const handleModelChange = (val: string) => {
    setConfig(prev => {
        // Reset stability to a valid V3 default if switching to V3
        const isSwitchingToV3 = val === 'eleven_v3';
        return {
            ...prev,
            modelId: val,
            stability: isSwitchingToV3 ? 0.5 : prev.stability
        };
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 md:p-8 font-sans text-slate-200">
      <header className="max-w-6xl mx-auto mb-8 flex items-center justify-between border-b border-slate-800 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Play className="text-white fill-white" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              ElevenLab - Q
            </h1>
            <p className="text-xs text-slate-500 font-medium tracking-wide">PROFESSIONAL BATCH TTS</p>
          </div>
        </div>
        <div className="flex gap-2 text-xs font-mono text-slate-500">
          <span className={`px-2 py-1 rounded-full border ${status === AppStatus.PROCESSING ? 'border-amber-500/30 text-amber-500 bg-amber-500/10' : 'border-slate-800 bg-slate-900'}`}>
             {status === AppStatus.IDLE ? 'READY' : status === AppStatus.PROCESSING ? 'PROCESSING...' : 'DONE'}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Inputs & Settings */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* File Inputs Card */}
          <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-sm backdrop-blur-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100 mb-4">
              <Upload size={16} className="text-indigo-400" /> Source Files
            </h2>
            
            <div className="space-y-3">
              <FileInput label="API Keys (.txt)" accepted=".txt" loadedName={filesLoaded.api} onChange={(e) => handleFileUpload(e, 'api')} />
              <FileInput label="Voice ID (.txt)" accepted=".txt" loadedName={filesLoaded.voice} onChange={(e) => handleFileUpload(e, 'voice')} />
              <FileInput label="Texts (.txt)" accepted=".txt" loadedName={filesLoaded.text} onChange={(e) => handleFileUpload(e, 'text')} />
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800">
               <p className="text-xs text-slate-500 mb-2">Parsed Info:</p>
               <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-950 p-2 rounded border border-slate-800">
                      <span className="block text-slate-400">Keys</span>
                      <span className="font-mono text-indigo-300">{apiKeys.length}</span>
                  </div>
                  <div className="bg-slate-950 p-2 rounded border border-slate-800">
                      <span className="block text-slate-400">Voice ID</span>
                      <span className="font-mono text-indigo-300 truncate" title={voiceId}>{voiceId || '-'}</span>
                  </div>
               </div>
            </div>
          </section>

          {/* Settings Card */}
          <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 shadow-sm backdrop-blur-sm">
             <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100 mb-4">
              <Settings size={16} className="text-indigo-400" /> Configuration
            </h2>
            
            <SelectControl 
              label="Model" 
              value={config.modelId} 
              options={MODELS} 
              onChange={handleModelChange} 
            />

            <div className="space-y-4 my-6">
              {/* Conditional rendering for V3 */}
              {isV3 ? (
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Stability (V3 Alpha)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Creative (0.0)', val: 0.0 },
                        { label: 'Natural (0.5)', val: 0.5 },
                        { label: 'Robust (1.0)', val: 1.0 }
                      ].map((opt) => (
                        <button
                          key={opt.val}
                          onClick={() => setConfig(prev => ({ ...prev, stability: opt.val }))}
                          className={`text-xs py-2 px-1 rounded-lg border transition-all ${
                            config.stability === opt.val 
                              ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-900/50' 
                              : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                        Note: V3 Alpha only supports specific stability levels and ignores other voice settings.
                    </p>
                  </div>
              ) : (
                <>
                  <SliderControl 
                    label="Stability" 
                    value={config.stability} 
                    min={0} max={1} step={0.05} 
                    onChange={(v) => setConfig(prev => ({...prev, stability: v}))}
                  />
                  <SliderControl 
                    label="Similarity" 
                    value={config.similarityBoost} 
                    min={0} max={1} step={0.05} 
                    onChange={(v) => setConfig(prev => ({...prev, similarityBoost: v}))}
                  />
                  <SliderControl 
                    label="Style Exaggeration" 
                    value={config.style} 
                    min={0} max={1} step={0.05} 
                    onChange={(v) => setConfig(prev => ({...prev, style: v}))}
                  />
                  <SliderControl 
                    label="Speaking Rate (Speed)" 
                    value={config.speed} 
                    min={0.5} max={2.0} step={0.05} 
                    onChange={(v) => setConfig(prev => ({...prev, speed: v}))}
                    description="0.5x (Slow) - 2.0x (Fast). Default is 1.0."
                  />
                  <div className="flex items-center justify-between mb-4 p-3 bg-slate-950 rounded-lg border border-slate-800">
                    <label className="text-sm font-medium text-slate-300">Speaker Boost</label>
                    <input 
                      type="checkbox" 
                      checked={config.useSpeakerBoost} 
                      onChange={(e) => setConfig(prev => ({...prev, useSpeakerBoost: e.target.checked}))}
                      className="w-4 h-4 text-indigo-600 bg-slate-700 border-slate-600 rounded focus:ring-indigo-600 ring-offset-slate-800 focus:ring-2"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
               <SelectControl label="Format" value={config.outputFormat} options={OUTPUT_FORMATS} onChange={(v) => setConfig(prev => ({...prev, outputFormat: v}))} />
               <SelectControl label="Latency" value={config.latency} options={LATENCY_OPTS.map(o => ({...o, value: o.value.toString()}))} onChange={(v) => setConfig(prev => ({...prev, latency: parseInt(v)}))} />
            </div>

          </section>

           <button 
              onClick={runBatch}
              disabled={status === AppStatus.PROCESSING}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all ${
                status === AppStatus.PROCESSING 
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 active:scale-[0.98]'
              }`}
            >
              {status === AppStatus.PROCESSING ? (
                <><Loader2 className="animate-spin" /> Processing...</>
              ) : (
                <><Play className="fill-current" /> Generate Audio</>
              )}
            </button>
        </div>

        {/* Right Column: Output Logs */}
        <div className="lg:col-span-8 flex flex-col h-[calc(100vh-8rem)]">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl flex-1 flex flex-col overflow-hidden shadow-xl">
             <div className="p-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur z-10 flex justify-between items-center">
               <h2 className="font-semibold flex items-center gap-2">
                 <FileText size={16} className="text-indigo-400"/> Output Log
               </h2>
               {logs.some(l => l.status === 'success') && (
                 <button onClick={downloadAllZip} className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors border border-slate-700">
                   <Save size={14} /> Download ZIP
                 </button>
               )}
             </div>
             
             {status === AppStatus.PROCESSING && (
               <div className="h-1 w-full bg-slate-800">
                 <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
               </div>
             )}

             <div className="flex-1 overflow-y-auto p-4 space-y-3">
               {logs.length === 0 && (
                 <div className="h-full flex flex-col items-center justify-center text-slate-600">
                   <div className="p-4 rounded-full bg-slate-800/50 mb-4">
                     <Play size={32} className="opacity-20" />
                   </div>
                   <p>Ready to generate.</p>
                   <p className="text-sm">Upload files and click "Generate Audio" to start.</p>
                 </div>
               )}

               {logs.map((log) => (
                 <div key={log.id} className={`p-4 rounded-xl border transition-all ${
                   log.status === 'processing' ? 'bg-indigo-900/10 border-indigo-500/30' : 
                   log.status === 'success' ? 'bg-slate-800/40 border-slate-700 hover:bg-slate-800/60' : 
                   log.status === 'error' ? 'bg-red-900/10 border-red-500/30' :
                   'bg-slate-900 border-slate-800 opacity-50'
                 }`}>
                   <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          log.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                          log.status === 'error' ? 'bg-red-500/20 text-red-400' :
                          log.status === 'processing' ? 'bg-indigo-500/20 text-indigo-400' :
                          'bg-slate-700 text-slate-400'
                        }`}>
                           {log.id + 1}
                        </span>
                        <span className="text-xs font-mono text-slate-500">
                          {log.status === 'success' ? `API: ${log.apiKeyUsed}` : log.status.toUpperCase()}
                        </span>
                      </div>
                      {log.audioBlob && (
                         <button 
                            onClick={() => downloadSingle(log.audioBlob!, log.id)}
                            className="text-slate-400 hover:text-white transition-colors"
                            title="Download this file"
                         >
                           <Download size={16} />
                         </button>
                      )}
                   </div>
                   
                   <p className="text-sm text-slate-300 mb-3 font-medium line-clamp-2">
                     {log.textSnippet}
                   </p>

                   {log.status === 'error' && (
                     <div className="text-xs text-red-400 flex items-center gap-2">
                       <AlertCircle size={12} /> {log.message}
                     </div>
                   )}

                   {log.audioUrl && (
                     <audio controls className="w-full h-8 mt-2 block rounded-lg" src={log.audioUrl} />
                   )}
                 </div>
               ))}
             </div>
          </div>
        </div>
      </main>
    </div>
  );
}

const FileInput = ({ label, accepted, onChange, loadedName }: { label: string, accepted: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, loadedName: string }) => (
  <div className="relative group">
    <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">{label}</label>
    <div className={`relative flex items-center justify-between p-3 rounded-lg border transition-all ${loadedName ? 'bg-indigo-900/10 border-indigo-500/30' : 'bg-slate-950 border-slate-800 hover:border-slate-700'}`}>
       <div className="flex items-center gap-3 overflow-hidden">
          <div className={`w-8 h-8 rounded flex items-center justify-center ${loadedName ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
            {loadedName ? <CheckCircle size={16} /> : <FileText size={16} />}
          </div>
          <span className={`text-sm truncate ${loadedName ? 'text-indigo-200' : 'text-slate-500'}`}>
            {loadedName || 'No file chosen'}
          </span>
       </div>
       <input 
          type="file" 
          accept={accepted} 
          onChange={onChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
       />
       <div className="bg-slate-800 text-slate-300 text-xs px-2 py-1 rounded pointer-events-none">
          Browse
       </div>
    </div>
  </div>
);