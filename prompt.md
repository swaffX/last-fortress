# PROJECT: LAST FORTRESS

Create a complete browser-based multiplayer co-op survival tower defense game inspired by Zombs.io, but with more depth, better visuals, more progression systems and modern effects.

The game should be fully playable online and support private lobbies through party codes.

# CORE IDEA

Players must survive endless waves of zombies.

The game supports:

* Solo mode
* 2-player co-op (primary target)
* Future scalability for 4 players

Players share one base and one economy.

The objective is not simply defending the castle.

The castle acts as the main headquarters and command center, while the rest of the map becomes a player-built fortress.

The gameplay loop is:

Gather → Kill enemies → Earn coins → Expand → Upgrade → Survive stronger waves.

The game should feel like a mixture of:

* Zombs.io
* They Are Billions
* Kingdom Rush
* Age of Empires
* Clash of Clans
* Vampire Survivors

with modern juicy effects and satisfying feedback.

---

# CAMERA

Top-down view.

Slight angle (around 70 degrees).

Smooth camera.

Camera shake during:

* explosions
* catapult impacts
* giant zombie attacks
* boss attacks

---

# MAP

Single fixed map.

Large square battlefield.

Center:

The players' headquarters.

Surroundings:

Dense forest.

Stone deposits.

Abandoned houses.

Destroyed villages.

Old watchtowers.

Rivers.

Bridges.

Cemeteries.

Dark swamps.

Fog zones.

Zombie spawn areas around the edges.

The atmosphere should become darker every night.

---

# DAY AND NIGHT SYSTEM

Day:

Safe phase.

Players can:

Build structures.

Upgrade defenses.

Repair walls.

Gather resources.

Explore.

Night:

Zombie invasion begins.

Sky becomes darker.

Moonlight appears.

Fog increases.

Ambient sounds become tense.

Music becomes more intense.

---

# RESOURCE SYSTEM

Resources:

Wood

Stone

Iron

Gold

Crystal

Coins

Enemies reward coins.

Rare enemies may drop:

Crystals

Blueprints

Legendary materials

---

# BUILDING SYSTEM

Everything should snap to grid.

Players can rotate structures.

Visual placement preview.

Green if valid.

Red if blocked.

Building categories:

---

DEFENSE

Wood Wall

Stone Wall

Steel Wall

Gate

Spike Barricade

Slow Trap

Fire Trap

Electric Trap

Poison Trap

---

TOWERS

Archer Tower

Crossbow Tower

Ballista Tower

Catapult

Trebuchet

Magic Tower

Ice Tower

Lightning Tower

Bomb Tower

Flamethrower Tower

Sniper Tower

Tesla Tower

Mortar Tower

Poison Tower

Laser Tower

---

SUPPORT

Healing Totem

Buff Beacon

Radar Tower

Watch Tower

Repair Station

Resource Storage

Ammo Depot

---

ECONOMY

Gold Mine

Wood Camp

Stone Quarry

Iron Mine

Crystal Extractor

Market

Bank

Workshop

Blacksmith

Research Lab

---

HEADQUARTERS

Main Castle.

Cannot be moved.

If destroyed:

Game over.

Castle has upgrade levels.

Level 1-10.

Each level unlocks:

New buildings.

New tower tiers.

New technologies.

New weapons.

---

UPGRADE SYSTEM

Every structure:

Tier I → Tier X

Upgrades improve:

Damage.

Range.

Attack speed.

Durability.

Visual appearance.

Each tier changes the model.

Higher tiers look much more impressive.

---

PLAYER CHARACTERS

Stylized low-poly medieval survivors.

Customizable.

Classes:

Knight

Engineer

Hunter

Mage

Support

Each class has passive abilities.

---

WEAPONS

Sword

Spear

Bow

Crossbow

Shotgun

Rifle

Flamethrower

Magic Staff

Rocket Launcher

Minigun

Legendary Weapons

Weapons have rarity:

Common

Rare

Epic

Legendary

Mythic

---

ENEMIES

Normal Zombie

Fast Zombie

Crawler Zombie

Tank Zombie

Spitter Zombie

Armored Zombie

Exploding Zombie

Poison Zombie

Electric Zombie

Ice Zombie

Necromancer Zombie

Mutated Zombie

Invisible Zombie

Flying Bat Zombie

Boss Zombies

Every enemy has unique behavior.

---

BOSSES

Every 10 waves.

Examples:

Butcher

Abomination

Giant Ogre Zombie

Necromancer King

Mutant Spider Queen

The Reaper

Ancient Titan

Bosses have:

Unique music.

Special attacks.

Area attacks.

Summons.

Phases.

Enrage mode.

Huge health bars.

Death cinematics.

---

WAVE SYSTEM

Waves scale infinitely.

Difficulty rises dynamically.

Wave patterns:

Easy

Medium

Hard

Rest

Boss

Elite

Nightmare

Mix enemy types intelligently.

Increase health and damage gradually.

---

SKILL TREE

Three branches:

Combat

Engineering

Economy

Players unlock:

Critical chance.

Attack speed.

Build speed.

Tower buffs.

Resource bonuses.

Healing bonuses.

Ultimate abilities.

---

CO-OP SYSTEM

Party code.

Join friend instantly.

Shared resources.

Ping system.

Revive teammates.

Emotes.

Friend indicators.

Map markers.

---

UI

Modern.

Smooth.

Animated.

Rounded corners.

Blue-orange color palette.

HUD contains:

Wave number.

Coins.

Resources.

Castle health.

Minimap.

Party panel.

Building menu.

Inventory.

Skill tree.

Research tree.

Damage numbers.

Notifications.

---

VISUAL STYLE

Stylized 3D.

Low poly with high quality shaders.

Bright daytime.

Dark atmospheric nights.

Strong readability.

Satisfying particles.

---

VFX

Explosion particles.

Dust.

Fire.

Smoke.

Blood splashes.

Arrow trails.

Lightning chains.

Ice shattering.

Poison clouds.

Shockwaves.

Debris.

Camera shake.

Screen flashes.

Boss impact effects.

Everything should feel juicy and satisfying.

---

SFX

Medieval sounds.

Zombie growls.

Explosions.

Metal impacts.

Arrow sounds.

Catapult launches.

Fire crackling.

Electric arcs.

Tower upgrades.

Coin pickup sounds.

Boss roars.

---

MUSIC

Day:

Peaceful fantasy music.

Night:

Dark combat music.

Boss:

Epic orchestral themes.

Music transitions smoothly.

---

ANIMATIONS

Idle animations.

Run animations.

Attack animations.

Hit reactions.

Death animations.

Building animations.

Upgrade animations.

Tower recoil.

Boss phase animations.

Destruction animations.

---

POLISH

Floating damage numbers.

Critical hit effects.

Combo indicators.

Screen shake.

Smooth tween animations.

Dynamic shadows.

Bloom.

Fog.

Weather system.

Rain.

Thunder.

Wind.

Leaves moving.

Fire flickering.

---

NETWORKING

Authoritative server.

Anti-cheat design.

State synchronization.

Lag compensation.

Reconnect system.

Host migration.

Private lobbies.

Party codes.

Save progression.

---

ARCHITECTURE

Use a scalable codebase.

Component-based systems.

Managers:

WaveManager

EnemyManager

BuildingManager

CombatManager

EconomyManager

LobbyManager

NetworkManager

AudioManager

SaveManager

EffectManager

UIManager

ResearchManager

QuestManager

Keep code clean, modular and production-ready.

Build the game as if it could later become a commercial .io game.
