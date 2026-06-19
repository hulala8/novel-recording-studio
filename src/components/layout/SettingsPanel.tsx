"use client";

import { useState, useEffect } from "react";

export default function SettingsPanel() {
  const [open, setOpen] = useState(false);

  // Electron env status
  const [envStatus, setEnvStatus] = useState<{
    configPath: string;
    configFileExists: boolean;
  } | null>(null);
  const isElectron = typeof window !== "undefined" && window.electronAPI?.isElectron;

  useEffect(() => {
    if (isElectron) {
      window.electronAPI!.getEnvStatus().then(setEnvStatus);
    }
  }, [isElectron]);

  return (
    <>
      {/* Toggle button — bottom-left corner */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-4 left-4 z-40 w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-colors shadow-lg"
        title="设置"
      >
        ⚙
      </button>

      {/* Settings panel overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-start pointer-events-none">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 pointer-events-auto"
            onClick={() => setOpen(false)}
          />

          {/* Panel — anchored bottom-left, above the gear button */}
          <div className="relative mb-16 ml-4 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 pointer-events-auto max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-zinc-200">设置</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-sm"
              >
                ✕
              </button>
            </div>

            {/* Role Recognition Mode */}
            {isElectron && envStatus && (
              <div className="space-y-3 mb-4 pb-4 border-b border-zinc-800">
                <p className="text-xs font-medium text-zinc-400 border-b border-zinc-800 pb-1">
                  🔍 角色识别
                </p>
                <div className="space-y-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">识别模式</span>
                    <span className="text-blue-400">规则引擎</span>
                  </div>
                  <p className="text-zinc-500 leading-relaxed">
                    基于方括号标记、言说动词、后文归属等规则自动识别角色。无需配置 API 密钥。
                  </p>
                  <div className="mt-2 p-2 bg-zinc-800 rounded-md">
                    <p className="text-zinc-500 mb-1 leading-relaxed">
                      配置文件位置：
                    </p>
                    <p className="text-zinc-600 font-mono text-[10px] break-all">
                      {envStatus.configPath}
                    </p>
                    <button
                      onClick={() => window.electronAPI?.openConfigFolder()}
                      className="mt-2 text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                    >
                      📂 打开配置文件夹
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Keyboard shortcuts reference */}
            <div className={isElectron ? "mt-4 pt-3 border-t border-zinc-800" : ""}>
              <p className="text-xs font-medium text-zinc-400 mb-2">
                ⌨ 快捷键参考
              </p>
              <div className="space-y-1 text-[11px]">
                {[
                  // 录音控制
                  ["空格键", "开始 / 停止录音"],
                  ["Enter", "保存录音并继续下一段"],
                  ["Ctrl + R", "重新录制当前段"],
                  ["Ctrl + Z", "撤销当前段录音"],
                  // 导航
                  ["← →", "上一段 / 下一段"],
                  // 试听
                  ["P", "试听当前段 / 暂停"],
                  ["⇧ + P", "试听全部 / 暂停"],
                  // 编辑
                  ["S", "拆分长段落"],
                  ["A", "自动滚动（提词器）"],
                  // 波形选区
                  ["X", "剪切删除选区"],
                  ["T", "裁剪保留选区"],
                  ["Esc", "清除选区 / 退出提词器"],
                  // 界面
                  ["T", "切换提词器模式"],
                  ["E", "导出面板"],
                ].map(([key, desc]) => (
                  <div
                    key={key + desc}
                    className="flex items-center justify-between text-zinc-500"
                  >
                    <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">
                      {key}
                    </kbd>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
