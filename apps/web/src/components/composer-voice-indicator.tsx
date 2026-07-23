"use client";

type ComposerVoiceIndicatorProps = {
  transcript?: string;
};

export function ComposerVoiceIndicator({ transcript = "" }: ComposerVoiceIndicatorProps) {
  const hasTranscript = transcript.trim().length > 0;

  return (
    <span
      aria-hidden="true"
      className="composer-voice-indicator"
      data-has-transcript={hasTranscript ? "true" : "false"}
    >
      <i />
      <i />
      <i />
    </span>
  );
}
