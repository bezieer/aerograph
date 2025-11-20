
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { FluidSolver } from './utils/fluidSolver';
import { DEFAULT_CONFIG, CANVAS_BG_COLOR, SMOKE_COLOR } from './constants';
import { ToolMode, GeminiAnalysisResult } from './types';
import { IconCloud, IconWind, IconEraser, IconSparkles, IconTrash, IconDownload, IconCopy, IconCheck } from './components/Icons';
import { analyzeSmokeArt } from './services/geminiService';

const App: React.FC = () => {
  // DOM Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // State
  const [solver, setSolver] = useState<FluidSolver | null>(null);
  const [mode, setMode] = useState<ToolMode>(ToolMode.SMOKE);
  const [brushSize, setBrushSize] = useState<number>(4);
  const [isPaused, setIsPaused] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<GeminiAnalysisResult | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mouse/Touch State
  const isDragging = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Initialize Solver
  useEffect(() => {
    const s = new FluidSolver(
      DEFAULT_CONFIG.resolution,
      DEFAULT_CONFIG.diffusion,
      DEFAULT_CONFIG.viscosity,
      0.1 // dt
    );
    setSolver(s);

    // Cleanup? Nothing specific for pure JS class
  }, []);

  // Render Loop
  useEffect(() => {
    if (!solver || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    // Upscaling factor for rendering crispness on high DPI
    const renderScale = 4; // Render each grid cell as 4x4 pixels (or more depending on screen)
    
    // We render the 128x128 simulation to the full screen canvas
    const N = solver.size;
    const paddedSize = N + 2;
    const imageData = ctx.createImageData(paddedSize, paddedSize);
    const data = imageData.data;

    // Create an offscreen canvas for smoothing
    const offscreen = document.createElement('canvas');
    offscreen.width = paddedSize;
    offscreen.height = paddedSize;
    const offCtx = offscreen.getContext('2d');

    const render = () => {
      if (!isPaused) {
        solver.step(DEFAULT_CONFIG.iterations, DEFAULT_CONFIG.fadeRate);
      }

      // Map density to pixel data
      // Optimization: Loop directly through density array
      for (let i = 0; i < solver.density.length; i++) {
        const d = solver.density[i];
        const pixelIndex = i * 4;
        
        // RGBA
        // Black background, White smoke.
        data[pixelIndex] = SMOKE_COLOR.r;     // R
        data[pixelIndex + 1] = SMOKE_COLOR.g; // G
        data[pixelIndex + 2] = SMOKE_COLOR.b; // B
        data[pixelIndex + 3] = d;             // Alpha based on density (clamped by Uint8ClampedArray)
      }

      if (offCtx) {
        offCtx.putImageData(imageData, 0, 0);
        
        // Draw to main canvas with smoothing
        ctx.fillStyle = CANVAS_BG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        // Scale up to fit
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [solver, isPaused]);

  // Handle Resizing
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        canvasRef.current.width = clientWidth;
        canvasRef.current.height = clientHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Interaction Handlers
  const getPointerPos = (e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    let clientX, clientY;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    // Map screen coordinates to simulation grid coordinates (0 to N+1)
    const x = ((clientX - rect.left) / rect.width) * (DEFAULT_CONFIG.resolution + 2);
    const y = ((clientY - rect.top) / rect.height) * (DEFAULT_CONFIG.resolution + 2);
    
    return { x, y };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    isDragging.current = true;
    lastPos.current = getPointerPos(e);
  };

  const handleEnd = () => {
    isDragging.current = false;
    lastPos.current = null;
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging.current || !solver || !lastPos.current) return;
    
    const currentPos = getPointerPos(e);
    
    // Clamp coordinates to inner grid (1 to N) to prevent edge loss
    const N = solver.size;
    const mx = Math.max(1, Math.min(Math.floor(currentPos.x), N));
    const my = Math.max(1, Math.min(Math.floor(currentPos.y), N));
    
    const dx = currentPos.x - lastPos.current.x;
    const dy = currentPos.y - lastPos.current.y;
    
    // Force multiplier
    const forceMult = 5.0; 
    // Clamp force to prevent explosion
    const clampedDx = Math.max(-50, Math.min(50, dx * forceMult));
    const clampedDy = Math.max(-50, Math.min(50, dy * forceMult));

    // Apply brush logic over a radius
    const radius = brushSize;
    const r2 = radius * radius;

    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x * x + y * y <= r2) {
          const targetX = mx + x;
          const targetY = my + y;

          if (targetX > 0 && targetX <= N && targetY > 0 && targetY <= N) {
            // Apply Velocity to all tools to create movement
            solver.addVelocity(targetX, targetY, clampedDx, clampedDy);

            if (mode === ToolMode.SMOKE) {
               // Add density
               // Uncapped density allows for "thick" smoke that survives diffusion
               solver.addDensity(targetX, targetY, 150);
            } else if (mode === ToolMode.ERASER) {
               // Remove density
               solver.density[solver.IX(targetX, targetY)] = 0;
            }
          }
        }
      }
    }

    lastPos.current = currentPos;
  };

  // Actions
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleReset = () => {
    if (!solver) return;
    solver.density.fill(0);
    solver.Vx.fill(0);
    solver.Vy.fill(0);
    solver.Vx0.fill(0);
    solver.Vy0.fill(0);
    setAnalysisResult(null);
    setShowAnalysis(false);
    showToast("Canvas Cleared");
  };

  const handleSaveImage = () => {
    if (!canvasRef.current) return;
    try {
        const dataUrl = canvasRef.current.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `aerograph-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast("Image Saved");
    } catch (e) {
        console.error(e);
        showToast("Failed to Save");
    }
  };

  const handleCopyToClipboard = () => {
    if (!canvasRef.current) return;
    try {
        canvasRef.current.toBlob(blob => {
            if (blob) {
                navigator.clipboard.write([
                    new ClipboardItem({
                        'image/png': blob
                    })
                ]).then(() => {
                    showToast("Copied to Clipboard");
                }).catch(err => {
                    console.error("Clipboard write failed", err);
                    showToast("Clipboard Failed");
                });
            }
        });
    } catch (e) {
        console.error(e);
        showToast("Clipboard Failed");
    }
  };

  const handleGeminiAnalysis = async () => {
    if (!canvasRef.current) return;
    setIsAnalyzing(true);
    setShowAnalysis(true);
    setAnalysisResult(null);

    try {
        const dataUrl = canvasRef.current.toDataURL('image/png');
        const result = await analyzeSmokeArt(dataUrl);
        setAnalysisResult(result);
    } catch (e) {
        console.error(e);
        setAnalysisResult({
            title: "Connection Error",
            description: "Could not reach the oracle. Please try again.",
            mood: "Disconnected"
        });
    } finally {
        setIsAnalyzing(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-screen bg-black overflow-hidden">
      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        className="absolute top-0 left-0 cursor-crosshair touch-none"
      />

      {/* Floating Header */}
      <div className="absolute top-6 left-6 pointer-events-none select-none">
        <h1 className="text-white text-3xl font-extralight tracking-widest opacity-80">AERO<span className="font-bold">GRAPH</span></h1>
        <p className="text-gray-400 text-xs tracking-wider mt-1">FLUID DYNAMICS CANVAS</p>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-zinc-800/90 text-white px-4 py-2 rounded-full text-sm shadow-xl backdrop-blur border border-zinc-700 animate-in fade-in zoom-in duration-200 z-50 flex items-center gap-2">
            <IconCheck className="w-4 h-4 text-green-400" />
            {toastMessage}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex items-center gap-2 p-2 bg-zinc-900/80 backdrop-blur-md rounded-full border border-zinc-800 shadow-2xl max-w-[95vw] overflow-x-auto z-10 no-scrollbar">
        
        <button 
          onClick={() => setMode(ToolMode.SMOKE)}
          className={`p-3 rounded-full transition-all duration-300 flex-shrink-0 ${mode === ToolMode.SMOKE ? 'bg-white text-black scale-110 shadow-lg shadow-white/20' : 'text-gray-400 hover:text-white hover:bg-zinc-800'}`}
          title="Smoke Injector"
        >
          <IconCloud />
        </button>

        <button 
          onClick={() => setMode(ToolMode.WIND)}
          className={`p-3 rounded-full transition-all duration-300 flex-shrink-0 ${mode === ToolMode.WIND ? 'bg-white text-black scale-110 shadow-lg shadow-white/20' : 'text-gray-400 hover:text-white hover:bg-zinc-800'}`}
          title="Wind (Transparent)"
        >
          <IconWind />
        </button>

        <button 
          onClick={() => setMode(ToolMode.ERASER)}
          className={`p-3 rounded-full transition-all duration-300 flex-shrink-0 ${mode === ToolMode.ERASER ? 'bg-white text-black scale-110 shadow-lg shadow-white/20' : 'text-gray-400 hover:text-white hover:bg-zinc-800'}`}
          title="Vacuum"
        >
          <IconEraser />
        </button>

        <div className="w-px h-6 bg-zinc-700 mx-2 flex-shrink-0"></div>
        
        {/* Brush Size Slider */}
        <div className="flex flex-col justify-center px-2 w-32 flex-shrink-0">
          <div className="flex justify-between text-[9px] text-zinc-500 font-mono mb-1">
             <span>SIZE</span>
             <span>{brushSize}</span>
          </div>
          <input 
            type="range" 
            min="1" 
            max="20" 
            step="1"
            value={brushSize}
            onChange={(e) => setBrushSize(parseInt(e.target.value))}
            className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-white"
          />
        </div>

        <div className="w-px h-6 bg-zinc-700 mx-2 flex-shrink-0"></div>

        <button 
          onClick={handleReset}
          className="p-3 rounded-full text-red-400 hover:bg-red-900/30 hover:text-red-200 transition-colors flex-shrink-0"
          title="Clear Canvas"
        >
          <IconTrash />
        </button>

        <div className="w-px h-6 bg-zinc-700 mx-2 flex-shrink-0"></div>

        {/* Export Tools */}
        <button 
            onClick={handleSaveImage}
            className="p-3 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors flex-shrink-0"
            title="Save Image"
        >
            <IconDownload />
        </button>

        <button 
            onClick={handleCopyToClipboard}
            className="p-3 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors flex-shrink-0"
            title="Copy to Clipboard"
        >
            <IconCopy />
        </button>

        <div className="w-px h-6 bg-zinc-700 mx-2 flex-shrink-0"></div>

        <button
          onClick={handleGeminiAnalysis}
          disabled={isAnalyzing}
          className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all border border-indigo-500/30 flex-shrink-0
            ${isAnalyzing ? 'bg-indigo-900/20 text-indigo-300 animate-pulse' : 'bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white hover:border-indigo-500'}
          `}
        >
           <IconSparkles className={isAnalyzing ? "animate-spin" : ""} />
           <span className="text-sm font-medium hidden sm:inline">Ask Gemini</span>
        </button>
      </div>

      {/* Analysis Modal/Overlay */}
      {showAnalysis && (
        <div className="absolute top-20 right-6 w-80 bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 p-6 rounded-2xl shadow-2xl animate-in slide-in-from-right-10 duration-500 z-20">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-indigo-400 text-xs font-bold tracking-widest uppercase">Analysis Result</h2>
            <button 
              onClick={() => setShowAnalysis(false)} 
              className="text-gray-500 hover:text-white"
            >
              ✕
            </button>
          </div>
          
          {isAnalyzing ? (
            <div className="space-y-3">
               <div className="h-4 bg-zinc-800 rounded w-3/4 animate-pulse"></div>
               <div className="h-3 bg-zinc-800 rounded w-full animate-pulse"></div>
               <div className="h-3 bg-zinc-800 rounded w-5/6 animate-pulse"></div>
               <p className="text-xs text-gray-500 mt-2">Consulting the oracle...</p>
            </div>
          ) : analysisResult ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-2xl font-light text-white font-serif italic">"{analysisResult.title}"</h3>
              </div>
              <div className="space-y-1">
                <p className="text-zinc-400 text-sm leading-relaxed">{analysisResult.description}</p>
              </div>
              <div className="flex items-center gap-2 mt-2">
                 <span className="text-xs uppercase tracking-wider text-zinc-600">Mood:</span>
                 <span className="text-xs text-white bg-zinc-800 px-2 py-1 rounded-md">{analysisResult.mood}</span>
              </div>
            </div>
          ) : (
            <p className="text-red-400 text-sm">Failed to analyze.</p>
          )}
        </div>
      )}
      
      {/* Info Overlay for first time users */}
      <div className="absolute bottom-6 right-6 text-right hidden md:block pointer-events-none opacity-50">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest">Hold Click to Paint</p>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest">Change Size to adjust plume</p>
      </div>
    </div>
  );
};

export default App;
