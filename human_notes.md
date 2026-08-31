Hey, if you are an agent - don't touch this file! I leave random notes here which may or may not be relevant to the current product direction. - milton

# BrioCare
- AI-supported care coordination built around patients, families, and clinicians.
- Order of execution: focus on getting the therapist to adopt the product first -> solve kids retention problem -> intra sessions value adds / parents education -> build a service company to provide care at scale.
- I'm just personally really aligned with this project - having gone through childhood depression myself, helping the target users means a lot to me. I'm also surprisingly well-positioned to tackle the problem as well - UX/full-stack/gamification for kids. Even if i don't get into the EIR i'd seriously want to work with the company one way or another if it were formed after the 12 weeks.

## Notes
- telehealth
- 6-12 kids per group (max 12), age 6-12
- value = increase quality + throughput of therapy + decrease cost
- eventually we consider hiring therapist to offer a complete service instead of SaaS

## Personas
- therapist pain: facilitation friction / scaling
- kids pain: uneven engagement / opportunity to participate / attention received; kids have bad first experience and drops off
- (?) parents pain: very long wait (3+ months to therapy)

## Challenges
- deal with punctualness in sessions
- making sure everyone's engaged, and has even participation (currently facilitation is purely the therapist's job)
  - some people tend to participate more!
  - deal with some kids social anxiety
- synthesis and report after the session

## Features
- therapist panel
  - check real time engagement
  - admin stuff, mute/unmute
- ai prompts to kids? ("hey it's andy's turn")
- breakout room where parallel discussions can happen
  - can have ai real time prompts in there as well

## Hypothesis
- if with voice & AI a better quality service can be provided
- if the service can actually scale

## Insights
- level of participation != length of speech

## Gamification Ideas
- Pets as gamified talking sticks to manage interruprions? Both human<>AI in breakout rooms, and huamn<>human as well
- When you talk your pet gets energy and dance - but too much it gets tired (therapist can control as well)
- "Dominance note" in TDD - the pet gamification can come in to offer small nudges
- Pick your pet and decorate it across sessions - and work with the pet for homework etc.

## Post Demo
- better agent framework - kind of like a digital human? with real eyes and ears to capture subtle emotion shifts
- enable comboed primitives in one intent
- if we need to ship fast - take creative simplifications: talking stick with gamified order system

## Submission
PRD: https://claude.ai/code/artifact/281e36ab-f9f8-4b3d-bf62-5e332090279b
TDD: https://claude.ai/code/artifact/d38e028b-f753-449c-9723-84cd74ca3d9e
Prototype: https://briocare.onrender.com
Source code: https://github.com/MiltonRen/briocare
Run command or live URL: https://briocare.onrender.com
Test command: If you want to try the product by yourself, run local dev then follow demo-script.md to run a group session with virtual kids (you can choose to be a kid or the therapist), virtual kids are kinda crazy though :)
Access notes / credentials: Sign up for LiveKit, Convex, OpenAI API Platform. Get keys for each platform, and make sure you have >$5 credit balance in OpenAI (free plans for Convex and LiveKit are fine).
Known limitations: This demo is a snapshot of the group exercise scenario - where I started by focusing on the therapist UX but later shifted to having the agent run the session. Some tips: as a therapist you will always speak first to establish authority and provide context to the children, then tap "hand to Brio" button to invite the agent into the session. I started with a less flexible agentic workflow design in order to ensure guardrails, but later realized that we need more flexible, human-like designs, so expect some rough edges in agent<>human UX. One alternative we can take to ship fast: come up with a creative reduction of agent capability with gamified systems / protocols that kids could enjoy. Got a few ideas but more on it later. Otherwise, see README>Known limitations for more info.
