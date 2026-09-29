# Test collector fixture — a simulated collector for exercising Scout's
# multiplayer path end-to-end (group thread, untrusted member, desk answers).
#
# NOT the product. Runs on its own Plow line (e.g. ln_p5) alongside the real
# desk; Scout starts a group thread with this number. No AGENT_ID — this
# fixture must not register on the Agent Index.
#
# Latest: https://github.com/plow-pbc/plow-openclaw-agent/commits/main
# Digest: https://public.ecr.aws/e1h7x4a2/plow-cloud-agents (tag base-<commit>)
FROM public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-771198a9609dcef54d44843e7da5329c17fa51b4@sha256:f1e7c421b97a80f1bd17015f96daceb965f350a241f7edc7e4d856a0e3a6f8f5

COPY prompt/persona.md /opt/plow/prompt/AGENTS.md
