"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import styles from "./onboarding-gate.module.css";

const onboardingStorageKey = "family-app.onboarding.v1";
const settingsStorageKey = "family-app.settings.v1";

type OnboardingStep = "welcome" | "network" | "ai";

type StoredSettings = {
  activeNetwork?: "internet" | "local" | null;
  lanIp?: string;
  networkMode?: "internet" | "local" | "auto";
  providers?: Array<Record<string, unknown>>;
  serverPort?: string;
  serverUrl?: string;
  [key: string]: unknown;
};

export function OnboardingGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [publicDomain, setPublicDomain] = useState("");
  const [lanAddress, setLanAddress] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const onboarding = JSON.parse(window.localStorage.getItem(onboardingStorageKey) || "null") as { completed?: boolean } | null;
      if (onboarding?.completed) {
        setReady(true);
        return;
      }
      setPublicDomain(window.location.host || "localhost:3000");
    } catch {
      setPublicDomain(window.location.host || "localhost:3000");
    }
  }, []);

  if (ready) return <>{children}</>;

  function continueFromNetwork(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domain = normalizePublicDomain(publicDomain);
    if (!domain) {
      setMessage("请填写公网域名或当前访问地址。");
      return;
    }
    setPublicDomain(domain);
    setLanAddress(normalizeLanAddress(lanAddress));
    setMessage("");
    setStep("ai");
  }

  function completeOnboarding() {
    const publicTarget = parsePublicTarget(publicDomain);
    const normalizedLan = normalizeLanAddress(lanAddress);
    let storedSettings: StoredSettings = {};
    try {
      storedSettings = JSON.parse(window.localStorage.getItem(settingsStorageKey) || "{}") as StoredSettings;
    } catch {
      storedSettings = {};
    }

    const providers = apiKey.trim()
      ? upsertDeepSeekProvider(storedSettings.providers, apiKey.trim())
      : storedSettings.providers;
    window.localStorage.setItem(settingsStorageKey, JSON.stringify({
      ...storedSettings,
      activeNetwork: "internet",
      lanIp: normalizedLan,
      networkMode: "auto",
      providers,
      serverPort: publicTarget.port,
      serverUrl: publicTarget.host
    }));
    window.localStorage.setItem(onboardingStorageKey, JSON.stringify({
      aiConfigured: Boolean(apiKey.trim()),
      completed: true,
      completedAt: new Date().toISOString(),
      lanAddress: normalizedLan,
      publicDomain: publicTarget.host
    }));
    setReady(true);
  }

  return (
    <main className={styles.shell}>
      <section aria-label="新用户引导" className={styles.card}>
        <header className={styles.brand}>
          <Image alt="我爱饭米粒" className={styles.logo} height={72} priority src="/family-logo-v2.png" width={72} />
          <div>
            <span>我爱饭米粒</span>
            <small>用心记录 · 守护家庭</small>
          </div>
        </header>

        {step === "welcome" ? (
          <div className={styles.welcome}>
            <p className={styles.eyebrow}>欢迎</p>
            <h1>创建你的家庭空间</h1>
            <p className={styles.lead}>确认访问方式，即可开始。</p>
            <button className={styles.primary} onClick={() => setStep("network")} type="button">开始</button>
          </div>
        ) : null}

        {step === "network" ? (
          <form className={styles.form} onSubmit={continueFromNetwork}>
            <StepHeader current={1} title="设置访问地址" description="公网地址已填好，局域网地址可选。" />
            <label className={styles.field}>
              <span>公网地址</span>
              <input autoCapitalize="none" autoCorrect="off" onChange={(event) => setPublicDomain(event.target.value)} placeholder="family.example.com" spellCheck={false} value={publicDomain} />
            </label>
            <label className={styles.field}>
              <span>局域网地址 <em>可选</em></span>
              <input autoCapitalize="none" autoCorrect="off" onChange={(event) => setLanAddress(event.target.value)} placeholder="192.168.1.100" spellCheck={false} value={lanAddress} />
            </label>
            {message ? <p className={styles.message} role="alert">{message}</p> : null}
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={() => setStep("welcome")} type="button">返回</button>
              <button className={styles.primary} type="submit">下一步</button>
            </div>
          </form>
        ) : null}

        {step === "ai" ? (
          <div className={styles.form}>
            <StepHeader current={2} title="连接 AI" description="可选，稍后也能设置。" />
            <label className={styles.field}>
              <span>DeepSeek API Key <em>可选</em></span>
              <input autoComplete="off" onChange={(event) => setApiKey(event.target.value)} placeholder="sk-••••••••" type="password" value={apiKey} />
              <small>仅保存在当前浏览器。</small>
            </label>
            <div className={styles.summary}>
              <span>当前地址</span>
              <strong>{publicDomain}</strong>
              <small>{lanAddress ? `局域网 ${lanAddress}` : "未设置局域网地址"}</small>
            </div>
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={() => setStep("network")} type="button">返回</button>
              <button className={styles.primary} onClick={completeOnboarding} type="button">进入家庭空间</button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function StepHeader({ current, description, title }: { current: 1 | 2; description: string; title: string }) {
  return (
    <header className={styles.stepHeader}>
      <div aria-label={`设置进度 ${current}/2`} className={styles.progress}>
        {[1, 2].map((step) => <i aria-current={current === step ? "step" : undefined} className={current >= step ? styles.active : ""} key={step} />)}
      </div>
      <p className={styles.eyebrow}>{current} / 2</p>
      <h1>{title}</h1>
      <p className={styles.lead}>{description}</p>
    </header>
  );
}

function normalizePublicDomain(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).host;
  } catch {
    return "";
  }
}

function normalizeLanAddress(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").split("/")[0] || "";
}

function parsePublicTarget(value: string) {
  const target = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  return { host: target.hostname, port: target.port || (target.protocol === "http:" ? "80" : "443") };
}

function upsertDeepSeekProvider(providers: Array<Record<string, unknown>> | undefined, apiKey: string) {
  const next = Array.isArray(providers) ? [...providers] : [];
  const provider = {
    apiKey,
    deepModel: "deepseek-v4-pro",
    endpoint: "https://api.deepseek.com",
    fastModel: "deepseek-v4-flash",
    id: "deepseek",
    kind: "deepseek",
    name: "DeepSeek",
    status: "connected"
  };
  const index = next.findIndex((item) => item.id === "deepseek" || item.kind === "deepseek");
  if (index >= 0) next[index] = { ...next[index], ...provider };
  else next.unshift(provider);
  return next;
}
