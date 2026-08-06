"use client";

import React, { useState } from "react";
import { UserProfile } from "@/types";
import { Input } from "@/components/shared/Input";
import { User, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ProfileSectionProps {
  user: UserProfile;
  onSave: (updates: { name: string; currentPassword?: string; newPassword?: string }) => Promise<void>;
}

export const ProfileSection: React.FC<ProfileSectionProps> = ({ user, onSave }) => {
  const [name, setName]                     = useState(user.name);
  const [currentPassword, setCurrentPwd]    = useState("");
  const [newPassword, setNewPassword]       = useState("");
  const [confirmPassword, setConfirmPwd]    = useState("");
  const [showCurrent, setShowCurrent]       = useState(false);
  const [showNew, setShowNew]               = useState(false);
  const [isSaving, setIsSaving]             = useState(false);
  const [nameError, setNameError]           = useState("");
  const [pwdError, setPwdError]             = useState("");

  const validate = (): boolean => {
    let ok = true;
    if (!name.trim()) { setNameError("Name is required."); ok = false; } else setNameError("");
    if (newPassword || currentPassword) {
      if (!currentPassword) { setPwdError("Enter your current password to set a new one."); ok = false; }
      else if (newPassword.length < 8) { setPwdError("New password must be at least 8 characters."); ok = false; }
      else if (newPassword !== confirmPassword) { setPwdError("Passwords do not match."); ok = false; }
      else setPwdError("");
    } else setPwdError("");
    return ok;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      setCurrentPwd("");
      setNewPassword("");
      setConfirmPwd("");
    } finally {
      setIsSaving(false);
    }
  };

  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-[18px] font-bold text-white">Profile</h2>
        <p className="text-[13px] text-[#AAB5AF] mt-1">Update your name and password.</p>
      </div>

      {/* Avatar placeholder */}
      <div className="flex items-center gap-4 p-4 bg-[#0B120F] border border-[#1E3025] rounded-2xl">
        <div className="w-14 h-14 rounded-2xl bg-[#2E7D32]/25 border-2 border-[#2E7D32]/40 flex items-center justify-center text-[#2E7D32] font-bold text-xl select-none">
          {initials || "?"}
        </div>
        <div>
          <p className="text-[14px] font-semibold text-white">{user.name}</p>
          <p className="text-[12px] text-[#7E8A84]">{user.email}</p>
          <p className="text-[10px] font-mono text-[#2E7D32] mt-0.5">ID: {user.id}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Name */}
        <div>
          <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">
            Full Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            leftIcon={<User className="w-4 h-4" />}
            error={nameError}
          />
        </div>

        {/* Email (read-only) */}
        <div>
          <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">
            Email Address
          </label>
          <Input
            type="email"
            value={user.email}
            readOnly
            disabled
            leftIcon={<Mail className="w-4 h-4" />}
            className="opacity-50 cursor-not-allowed"
          />
          <p className="text-[11px] text-[#7E8A84] mt-1">Email cannot be changed here.</p>
        </div>

        {/* Password change section */}
        <div className="pt-2 border-t border-[#1E3025]">
          <p className="text-[13px] font-semibold text-white mb-4">Change Password</p>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">
                Current Password
              </label>
              <Input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPwd(e.target.value)}
                placeholder="Leave blank to keep current"
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={
                  <button type="button" onClick={() => setShowCurrent((v) => !v)} className="text-[#7E8A84] hover:text-white transition-colors p-1">
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">
                New Password
              </label>
              <Input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={
                  <button type="button" onClick={() => setShowNew((v) => !v)} className="text-[#7E8A84] hover:text-white transition-colors p-1">
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
                error={pwdError}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1.5">
                Confirm New Password
              </label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Repeat new password"
                leftIcon={<Lock className="w-4 h-4" />}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <motion.button
            type="submit"
            disabled={isSaving}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className={cn(
              "flex items-center gap-2 h-10 px-6 rounded-xl text-[13px] font-bold transition-all",
              isSaving
                ? "bg-[#2E7D32]/50 text-white/60 cursor-not-allowed"
                : "bg-[#2E7D32] hover:bg-[#388E3C] text-white"
            )}
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </motion.button>
        </div>
      </form>
    </div>
  );
};
