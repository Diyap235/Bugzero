"use client";

import React, { useState } from "react";
import { Dialog } from "../shared/Dialog";
import { Input } from "../shared/Input";
import { Button } from "../shared/Button";

interface CreateRepositoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, language: string) => Promise<void>;
}

export const CreateRepositoryDialog: React.FC<CreateRepositoryDialogProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("Python");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Repository name is required");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      await onCreate(name.trim(), description.trim(), language);
      setName("");
      setDescription("");
      onClose();
    } catch {
      setError("Failed to create repository");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Repository"
      description="Add a source repository to begin AI static analysis and code health monitoring."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1">
            Repository Name *
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. backend-auth-service"
            error={error}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1">
            Description
          </label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Microservice handling REST authentication..."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1">
            Primary Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full h-[48px] bg-surface border border-border rounded-input px-4 text-text-primary focus:outline-none focus:border-primary text-sm"
          >
            <option value="Python">Python</option>
            <option value="JavaScript">JavaScript</option>
            <option value="TypeScript">TypeScript</option>
            <option value="Go">Go</option>
          </select>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Create Repository
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
