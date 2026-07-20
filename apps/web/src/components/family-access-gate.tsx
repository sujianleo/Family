"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { isFamilyAuthRequired, isLocalFamilyAuth } from "@/lib/familyApi";
import { normalizePhoneNumber } from "@/lib/phoneAuth";
import { supabase } from "@/lib/supabase";
import styles from "./family-access-gate.module.css";

const rememberedAccountKey = "family-app-remembered-account";

export function FamilyAccessGate({ children, initialSignedIn }: { children: ReactNode; initialSignedIn: boolean }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signedIn, setSignedIn] = useState(initialSignedIn);

  useEffect(() => {
    const rememberedAccount = window.localStorage.getItem(rememberedAccountKey);
    if (rememberedAccount) {
      setPhone(rememberedAccount);
    }
    if (!isLocalFamilyAuth() && supabase) {
      void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    }
  }, []);

  if (!isFamilyAuthRequired() || signedIn) {
    return <>{children}</>;
  }

  async function signInWithPhone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      setMessage("请输入正确的手机号，例如 13812345678。");
      return;
    }
    if (!password) {
      setMessage("请输入密码。");
      return;
    }
    setSubmitting(true);
    setMessage("");
    const response = isLocalFamilyAuth()
      ? await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: normalizedPhone, password }) }).catch(() => null)
      : supabase
        ? await supabase.auth.signInWithPassword({ phone: normalizedPhone, password }).then(({ error }) => ({ ok: !error, json: async () => ({ detail: error?.message }) } as Response))
        : null;
    setSubmitting(false);
    if (!response?.ok) {
      const payload = response ? await response.json().catch(() => ({})) as { detail?: string } : {};
      setMessage(payload.detail || "暂时无法登录，请稍后重试。");
      return;
    }
    window.localStorage.setItem(rememberedAccountKey, phone.trim());
    setPassword("");
    setSignedIn(true);
  }

  return (
    <main className={`app-shell ${styles.state}`}>
      <form className={styles.card} onSubmit={signInWithPhone}>
        <Image alt="我爱饭米粒" className={styles.logo} height={112} priority src="/family-logo-v2.png" width={112} />
        <label className={styles.field}>
          <input aria-label="账户" autoComplete="username" inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="手机号" required type="tel" value={phone} />
        </label>
        <label className={styles.field}>
          <input aria-label="密码" autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder="密码" required type="password" value={password} />
        </label>
        <button className={styles.submit} disabled={submitting} type="submit">{submitting ? "正在登录…" : "登录"}</button>
        {message ? <small className={styles.message} role="alert">{message}</small> : null}
      </form>
    </main>
  );
}
