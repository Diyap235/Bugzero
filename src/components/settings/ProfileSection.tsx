"use client";

import React, { useState } from "react";
import { UserProfile } from "@/types";
import { Input } from "@/components/shared/Input";
import { Button } from "@/components/shared/Button";
import { User, Mail, Building2, Save } from "lucide-react";

interface ProfileSectionProps {
  user: UserProfile;
  onSave: (name: string, organization: string) => Promise<void>;
}

export const ProfileSection: React.FC<ProfileSectionProps> = ({ user, onSave }) => {
  const [name, setName] = useState(user.name);
  const [organization, setOrganization] = useState(user.organization ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave(name.trim(), organization.trim());
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-bold text-text-primary">Profile Information</h2>
        <p className="text-xs text-text-secondary mt-1">
          Update your display name and organization details.
        </p>
      </div>

      {/* Avatar + Email (read-only) */}
      <div className="flex items-center gap-4 p-4 bg-card border border-border rounded-card">
        <div className="w-14 h-14 rounded-full bg-primary/30 border-2 border-primary/50 flex items-center justify-center text-primary font-bold text-xl select-none">
          {user.name.charAt(0)}
        </div>
        <div>
          <span className="text-sm font-semibold text-text-primary">{user.name}</span>
          <span className="text-xs text-text-muted block">{user.email}</span>
          <span className="text-[10px] font-mono text-primary mt-0.5 block">ID: {user.id}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1.5">
            Full Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Vance"
            leftIcon={<User className="w-4 h-4" />}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1.5">
            Email Address
          </label>
          <Input
            type="email"
            value={user.email}
            readOnly
            disabled
            leftIcon={<Mail className="w-4 h-4" />}
            className="opacity-60 cursor-not-allowed"
          />
          <p className="text-[11px] text-text-muted mt-1 pl-1">
            Email cannot be changed. Contact support to update your email address.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1.5">
            Organization
          </label>
          <Input
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="Acme Engineering Corp."
            leftIcon={<Building2 className="w-4 h-4" />}
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            variant="primary"
            isLoading={isSaving}
            leftIcon={<Save className="w-4 h-4" />}
          >
            Save Profile
          </Button>
        </div>
      </form>
    </div>
  );
};
