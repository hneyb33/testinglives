"use client";

import { useApp } from "./AppContext";
import { IconCheck, IconClose } from "./Icons";

const LANGUAGES = [
  "English",
  "Kiswahili",
  "Luganda",
  "Français",
  "العربية",
];

export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const { language, setLanguage, toast } = useApp();

  function choose(lang: string) {
    setLanguage(lang);
    toast(`Language set to ${lang}`);
    onClose();
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-label="Choose language">
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="sheet-panel relative">
        <div className="flex items-center justify-between px-5 pb-1 pt-5">
          <h2 className="m-0 text-[20px] font-extrabold text-ink">Language</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close language picker">
            <IconClose />
          </button>
        </div>
        <div className="px-4 pb-6 pt-2">
          {LANGUAGES.map((lang) => {
            const selected = lang === language;
            return (
              <button
                key={lang}
                type="button"
                onClick={() => choose(lang)}
                className={`mb-2 flex h-[51px] w-full items-center justify-between rounded-[14px] px-4 text-left text-[15px] ${
                  selected ? "bg-primary text-white" : "bg-[#f1f6fd] text-ink hover:bg-card-blue"
                }`}
              >
                <span>{lang}</span>
                {selected && <IconCheck width={18} height={18} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
