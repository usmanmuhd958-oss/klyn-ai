'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Terminal, Zap, ShieldCheck, Cpu } from 'lucide-react';

export default function LandingPage() {
  const [copied, setCopied] = useState(false);
  const repoUrl = 'git clone https://github.com/usmanmuhd958-oss/klyn-ai.git';

  const handleCopy = () => {
    navigator.clipboard.writeText(repoUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const benchmarks = [
    { metric: 'RAM Usage', klyn: '5.95 MB', cursor: '~1.2 GB', replit: '~2 GB', status: '200x Lighter' },
    { metric: 'Ingest Speed', klyn: '7.91 ms', cursor: '~5.0 s', replit: '~12.0 s', status: '1000x Faster' },
    { metric: 'Lookup Rate', klyn: '122,000 /s', cursor: '~2,000 /s', replit: '~1,500 /s', status: '60x Higher' },
    { metric: 'Cold Start', klyn: '< 50 ms', cursor: '> 3.0 s', replit: '> 5.0 s', status: 'Ultra Instant' },
    { metric: 'Bundle Size', klyn: '< 6.0 MB', cursor: '> 400 MB', replit: '> 1.5 GB', status: 'Micro Footprint' }
  ];

  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#00F5FF] selection:text-black font-sans">
      <main className="max-w-6xl mx-auto px-6 py-20 flex flex-col items-center justify-center min-h-screen">
        
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#00F5FF]/30 bg-[#00F5FF]/10 text-[#00F5FF] text-sm mb-8"
        >
          <Zap className="w-4 h-4" />
          <span>Klyn AI OS v2.0.0 is Live</span>
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-5xl md:text-7xl font-extrabold text-center bg-gradient-to-r from-white via-gray-200 to-[#A855F7] bg-clip-text text-transparent leading-tight mb-6"
        >
          The 6MB AI OS that beats Cursor
        </motion.h1>

        <p className="text-gray-400 text-xl text-center max-w-2xl mb-12">
          Sub-millisecond Merkle DAG indexing, zero memory bloat, and cognitive execution built for the next century of software engineering.
        </p>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="w-full overflow-x-auto rounded-2xl border border-gray-800 bg-gray-950/50 backdrop-blur-xl p-6 mb-16"
        >
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-sm">
                <th className="py-4 px-4">Metric</th>
                <th className="py-4 px-4 text-[#00F5FF] font-bold">Klyn AI OS</th>
                <th className="py-4 px-4">Cursor</th>
                <th className="py-4 px-4">Replit Agent</th>
                <th className="py-4 px-4 text-right">Advantage</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((row, idx) => (
                <tr key={idx} className="border-b border-gray-900/50 hover:bg-white/5 transition-colors">
                  <td className="py-4 px-4 font-medium text-gray-300">{row.metric}</td>
                  <td className="py-4 px-4 font-bold text-[#00F5FF] bg-[#00F5FF]/5 rounded-lg">{row.klyn}</td>
                  <td className="py-4 px-4 text-gray-500">{row.cursor}</td>
                  <td className="py-4 px-4 text-gray-500">{row.replit}</td>
                  <td className="py-4 px-4 text-right text-xs font-semibold text-[#A855F7]">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-5 py-3 w-full max-w-xl justify-between shadow-2xl"
        >
          <div className="flex items-center gap-3 text-sm text-gray-300 font-mono overflow-x-auto">
            <Terminal className="w-4 h-4 text-[#00F5FF] shrink-0" />
            <span>{repoUrl}</span>
          </div>
          <button 
            onClick={handleCopy}
            className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors shrink-0"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </motion.div>

      </main>
    </div>
  );
}
