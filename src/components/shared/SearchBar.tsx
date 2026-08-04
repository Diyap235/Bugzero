"use client";

import React, { useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Input } from "./Input";

interface SearchBarProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = "Search repositories or findings... (Press / to focus)",
  value: initialValue = "",
  onChange,
  className,
}) => {
  const [query, setQuery] = useState(initialValue);
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(initialValue);
  }, [initialValue]);

  // Global '/' keyboard shortcut focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (onChange) onChange(val);
  };

  const handleClear = () => {
    setQuery("");
    if (onChange) onChange("");
    inputRef.current?.focus();
  };

  return (
    <Input
      ref={inputRef}
      value={query}
      onChange={handleChange}
      placeholder={placeholder}
      className={className}
      leftIcon={<Search className="w-4 h-4 text-text-muted" />}
      rightIcon={
        query ? (
          <button
            type="button"
            onClick={handleClear}
            className="hover:text-text-primary text-text-muted transition-colors p-1"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null
      }
    />
  );
};
