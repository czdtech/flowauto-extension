# FlowAuto v1.0.0 — Pre-Launch QA Checklist

## Build
- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` zero errors
- [ ] `npx vitest run` all tests pass

## Core Features
- [ ] Batch queue: add prompts, start, pause, resume
- [ ] Auto-download with project folder grouping
- [ ] Reference image injection (single and M x N)
- [ ] Model/mode/aspect ratio switching
- [ ] Resolution selection (720p/1080p/4K)

## P1: Chain + Stealth
- [ ] Chain Mode: output becomes next task's reference
- [ ] Stealth Mode: visibly slower delays
- [ ] Both modes combined

## P2: Project Management
- [ ] Create/rename/delete projects
- [ ] Switch projects preserves queues
- [ ] Storage quota warning

## P3: AI Engine
- [ ] OpenAI enhance/variants work
- [ ] Gemini enhance/variants work
- [ ] Auto-rewrite on policy violation

## P4: Notifications
- [ ] Telegram notification on queue complete
- [ ] Discord notification on queue complete
- [ ] Error notification

## P5: Payment
- [ ] Free tier: 30 task limit enforced
- [ ] Pro license activation
- [ ] Pro+ license activation
- [ ] Feature gate: locked features show lock icon
- [ ] Daily counter display

## CWS Compliance
- [ ] Privacy policy accessible
- [ ] All permissions justified
- [ ] No remote code execution
- [ ] Description under 132 chars
