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
            <p className={styles.eyebrow}>第一次见面</p>
            <h1>先把你们的家庭空间安顿好</h1>
            <p className={styles.lead}>用一分钟确认访问地址和 AI 服务。所有设置以后都能在 App 内修改。</p>
            <div className={styles.features}>
              <article><i aria-hidden="true">01</i><span><strong>家庭记录归位</strong><small>任务、群聊和资料各有自己的位置</small></span></article>
              <article><i aria-hidden="true">02</i><span><strong>重要写入先确认</strong><small>AI 只帮你理解和整理，不替家人做决定</small></span></article>
            </div>
            <button className={styles.primary} onClick={() => setStep("network")} type="button">开始设置</button>
          </div>
        ) : null}

        {step === "network" ? (
          <form className={styles.form} onSubmit={continueFromNetwork}>
            <StepHeader current={1} title="连接这个家庭" description="确认家人在外面和家里分别用什么地址访问。" />
            <label className={styles.field}>
              <span>公网域名</span>
              <input autoCapitalize="none" autoCorrect="off" onChange={(event) => setPublicDomain(event.target.value)} placeholder="family.example.com" spellCheck={false} value={publicDomain} />
              <small>已自动填入当前地址，可直接继续。</small>
            </label>
            <label className={styles.field}>
              <span>局域网地址 <em>可选</em></span>
              <input autoCapitalize="none" autoCorrect="off" onChange={(event) => setLanAddress(event.target.value)} placeholder="192.168.1.100" spellCheck={false} value={lanAddress} />
              <small>在家中 Wi-Fi 下可以使用更快的本地连接。</small>
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
            <StepHeader current={2} title="连接 AI 助手" description="AI 是增强项，不配置也能使用任务、群聊和资料。" />
            <label className={styles.field}>
              <span>DeepSeek API Key <em>可选</em></span>
              <input autoComplete="off" onChange={(event) => setApiKey(event.target.value)} placeholder="sk-••••••••" type="password" value={apiKey} />
              <small>只保存在当前浏览器设置中，稍后可在“设置 → AI”修改或测试。</small>
            </label>
            <div className={styles.summary}>
              <span>准备就绪</span>
              <strong>{publicDomain}</strong>
              <small>{lanAddress ? `本地地址 ${lanAddress}` : "暂不设置本地地址"}</small>
            </div>
            <div className={styles.actions}>
              <button className={styles.secondary} onClick={() => setStep("network")} type="button">返回</button>
              <button className={styles.primary} onClick={completeOnboarding} type="button">{apiKey.trim() ? "完成并进入" : "稍后配置 AI，先进入"}</button>
            </div>
          </div>
        ) : null}

        <footer className={styles.footer}>设置保存在当前设备中 · 可随时在 App 内修改</footer>
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
      <p className={styles.eyebrow}>第 {current} 步，共 2 步</p>
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
