#!/usr/bin/env node

import { automationActions, automationPipelines, getAutomationAction } from "../src/lib/automationRegistry";
import { compileComposerIntent } from "../src/lib/composerIntent";
import { runAutomationAction, runAutomationCommand, runAutomationPipeline } from "../src/lib/server/automationRunner";

const [command, ...args] = process.argv.slice(2);

runCli(command, args).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function runCli(commandName: string | undefined, argsValue: string[]) {
  if (!commandName || commandName === "help" || commandName === "--help") {
    printHelp();
    return;
  }

  if (commandName === "list") {
    const units = [
      ...automationActions.map((action) => ({
        id: action.id,
        kind: action.kind,
        label: action.label,
        unit: action.unit,
        aliases: action.slashAliases,
        parameters: action.parameters || {}
      })),
      ...automationPipelines.map((pipeline) => ({
        id: pipeline.id,
        unit: pipeline.unit,
        label: pipeline.label,
        aliases: pipeline.slashAliases,
        parameters: pipeline.parameters || {},
        steps: pipeline.steps
      }))
    ];
    printJson(units);
    return;
  }

  if (commandName === "intent") {
    const text = readTextArg(argsValue);
    printJson(compileComposerIntent(text));
    return;
  }

  if (commandName === "command") {
    const { text, options } = readTextAndOptions(argsValue);
    const result = await runAutomationCommand(text, toRunnerOptions({ ...options, text }));
    printJson(result);
    return;
  }

  if (commandName === "run") {
    const unitId = argsValue[0];
    if (!unitId) {
      throw new Error("缺少 action 或 pipeline id。");
    }

    const options = parseOptions(argsValue.slice(1));
    const pipeline = automationPipelines.find((item) => item.id === unitId);
    const action = getAutomationAction(unitId);
    if (!action && !pipeline) {
      throw new Error(`未知 action/pipeline id: ${unitId}`);
    }
    const result = pipeline ? await runAutomationPipeline(pipeline.id, toRunnerOptions(options)) : await runAutomationAction(unitId, toRunnerOptions(options));
    printJson(result);
    return;
  }

  throw new Error(`未知命令: ${commandName}`);
}

function printHelp() {
  console.log(`family-cli

Usage:
  npm run family -- list
  npm run family -- intent "创建一个群叫做闲聊群"
  npm run family -- command "创建一个群叫做闲聊群"
  npm run family -- run app.answer --text="家里现在有哪些人？"
  npm run family -- run app.answer --query-type=members.list --text="家里现在有哪些人？"
  npm run family -- run group.create --text="创建一个群叫做闲聊群"
  npm run family -- run profile.describe --member=老妈
  npm run family -- run member.rename --member=饭米粒 --new-name=豆包
  npm run family -- run meta.profiles.refresh
  npm run family -- run meta.summary.daily

Options:
  --text=TEXT
  --title=TITLE
  --member=NAME
  --options=A,B,C
  --actor-member-id=ID
  --actor-name=NAME
  --data-dir=DIR
`);
}

function readTextArg(argsValue: string[]) {
  const { text } = readTextAndOptions(argsValue);
  return text;
}

function readTextAndOptions(argsValue: string[]) {
  const options = parseOptions(argsValue);
  const text = options.text || argsValue.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (!text) {
    throw new Error("缺少文本参数。");
  }

  return {
    text,
    options
  };
}

function parseOptions(argsValue: string[]) {
  return argsValue.reduce<Record<string, string>>((acc, arg) => {
    if (!arg.startsWith("--")) {
      return acc;
    }

    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    acc[key] = rawValue.join("=").trim();
    return acc;
  }, {});
}

function toRunnerOptions(options: Record<string, string>) {
  return {
    actorMemberId: options.actorMemberId || null,
    actorName: options.actorName || null,
    dataDir: options.dataDir || "data",
    parameters: {
      text: options.text,
      query_type: options.queryType,
      title: options.title,
      member: options.member,
      new_name: options.newName,
      options: options.options
    }
  };
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
