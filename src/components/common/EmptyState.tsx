// src/components/common/EmptyState.tsx

import React from "react";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string | React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary";
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className = "",
}) => {
  return (
    <div className={`flex flex-col items-center justify-center p-8 text-center animate-in fade-in zoom-in-95 duration-700 ${className}`}>
      <div className="relative group mb-6">
        <div className="absolute inset-0 bg-primary-500/20 blur-[30px] rounded-full group-hover:bg-primary-500/30 transition-all duration-500 scale-110"></div>
        <div className="relative w-20 h-20 bg-white/70 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/5 rounded-[2rem] flex items-center justify-center shadow-2xl group-hover:scale-105 transition-transform duration-500">
          <Icon className="w-10 h-10 text-primary-500" strokeWidth={1.5} />
        </div>
      </div>
      
      <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">
        {title}
      </h3>
      
      <p className="text-[15px] text-gray-500 dark:text-gray-400 max-w-[280px] mx-auto font-medium leading-relaxed mb-8">
        {description}
      </p>
      
      <div className="flex flex-col gap-3 w-full max-w-[240px]">
        {action && (
          <button
            onClick={action.onClick}
            className={`px-8 py-3.5 bg-gradient-to-br from-primary-400 to-primary-600 text-white rounded-2xl font-black text-sm uppercase tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary-500/20 hover:shadow-primary-500/40`}
          >
            {action.label}
          </button>
        )}
        
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="px-6 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-primary-500 hover:bg-primary-500/5 rounded-2xl transition-all"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
};

export default EmptyState;
