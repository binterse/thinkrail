# ThinkRail — personal fork

This is my unofficial personal fork of [ThinkRail by JetBrains](https://github.com/JetBrains/thinkrail), with small fixes and changes for my own use. It is not an official JetBrains distribution.

For the product description, installation instructions, development guide, and project policies, see the [original ThinkRail README](https://github.com/JetBrains/thinkrail#readme) and [official website](https://thinkrail.ai/).

This fork is provided as-is, without support or maintenance commitments for other users. If you use it, you are responsible for your own setup and troubleshooting. Fix problems yourself or, if they also occur in the official version, report them to the official project.

For my local Windows setup, see [LOCAL-BUILD.md](LOCAL-BUILD.md). Application feedback, analytics, and update destinations remain those of upstream.

Contact: [LinkedIn](https://www.linkedin.com/in/wallback/).

This fork adds configurable model fallback for OpenCode Go and Codex chats. Choose an ordered reserve list beside the chat model picker and set it globally or per project. Quota exhaustion switches immediately; provider outages switch after pi's normal retries. The selected model is tried again on the next user turn. This feature uses a narrow patch to pi 1.5.2; unmodified pi 1.5.2 does not provide the required fallback hook.

ThinkRail is licensed under the [Apache License 2.0](LICENSE). Credit and existing attribution remain with the original authors and contributors.
