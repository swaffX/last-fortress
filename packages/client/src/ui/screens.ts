import { SKILLS, type ClassType } from '@lf/shared';
import type { ProfileView } from '../net';

/** Full-screen DOM states: menu, lobby, game over, skill tree overlay. */
export class Screens {
  private root = document.getElementById('screens')!;

  onCreate: (klass: ClassType, solo: boolean) => void = () => {};
  onJoin: (code: string, klass: ClassType) => void = () => {};
  onStart: () => void = () => {};
  onUnlockSkill: (id: string) => void = () => {};
  onPlayAgain: () => void = () => {};

  private klass: ClassType = 'knight';

  menu(profile: ProfileView | null): void {
    this.root.innerHTML = `
      <div class="screen">
        <div>
          <div class="title">Last Fortress</div>
          <div class="subtitle" style="text-align:center">Hold the line until dawn</div>
        </div>
        <div class="menu-card">
          <label>Choose your class</label>
          <div class="class-row">
            <button class="class-opt active" data-k="knight"><span class="ico">🛡</span>Knight</button>
            <button class="class-opt" data-k="hunter"><span class="ico">🏹</span>Hunter</button>
          </div>
          <button class="btn" id="solo-btn">Play Solo</button>
          <button class="btn" id="host-btn">Host Co-op</button>
          <label style="margin-top:6px">Or join with a party code</label>
          <input class="input" id="code-input" maxlength="5" placeholder="CODE">
          <button class="btn ghost" id="join-btn">Join Party</button>
          <button class="btn ghost" id="skills-btn">Skill Tree${profile && profile.skillPoints > 0 ? ` (${profile.skillPoints} pts)` : ''}</button>
        </div>
        ${profile ? `
        <div class="stat-grid">
          <div class="stat-cell"><div class="v">${profile.bestWave}</div><div class="k">Best Wave</div></div>
          <div class="stat-cell"><div class="v">${profile.totalKills}</div><div class="k">Kills</div></div>
          <div class="stat-cell"><div class="v">${profile.gamesPlayed}</div><div class="k">Games</div></div>
        </div>` : ''}
      </div>`;
    for (const el of this.root.querySelectorAll('.class-opt')) {
      (el as HTMLElement).onclick = () => {
        this.klass = (el as HTMLElement).dataset.k as ClassType;
        for (const o of this.root.querySelectorAll('.class-opt')) o.classList.toggle('active', o === el);
      };
    }
    (this.root.querySelector('#solo-btn') as HTMLElement).onclick = () => this.onCreate(this.klass, true);
    (this.root.querySelector('#host-btn') as HTMLElement).onclick = () => this.onCreate(this.klass, false);
    (this.root.querySelector('#join-btn') as HTMLElement).onclick = () => {
      const code = (this.root.querySelector('#code-input') as HTMLInputElement).value.trim().toUpperCase();
      if (code.length === 5) this.onJoin(code, this.klass);
    };
    (this.root.querySelector('#skills-btn') as HTMLElement).onclick = () => {
      if (profile) this.skillTree(profile, false);
    };
  }

  lobby(code: string, players: { name: string; klass: ClassType }[], host: boolean): void {
    this.root.innerHTML = `
      <div class="screen">
        <div class="subtitle">Party Code</div>
        <div class="party-code">${code}</div>
        <div class="lobby-roster">
          ${players.map(p => `
            <div class="roster-slot filled">
              <div>${esc(p.name)}</div><div class="klass">${p.klass}</div>
            </div>`).join('')}
          ${players.length < 2 ? '<div class="roster-slot">Waiting…</div>' : ''}
        </div>
        ${host
          ? '<button class="btn" id="start-btn">Begin the Watch</button>'
          : '<div class="subtitle">Waiting for host…</div>'}
      </div>`;
    this.root.querySelector('#start-btn')?.addEventListener('click', () => this.onStart());
  }

  onRestartVote: () => void = () => {};
  onMainMenu: () => void = () => {};

  gameOver(wave: number, coins: number, skillPoints: number): void {
    this.root.innerHTML = `
      <div class="screen">
        <div class="subtitle">The castle has fallen</div>
        <div class="gameover-wave">Wave ${wave}</div>
        <div class="stat-grid" style="grid-template-columns:repeat(2,1fr)">
          <div class="stat-cell"><div class="v">${coins}</div><div class="k">Coins Earned</div></div>
          <div class="stat-cell"><div class="v">+${skillPoints}</div><div class="k">Skill Points</div></div>
        </div>
        <div class="restart-row">
          <button class="btn" id="again-btn">Try Again</button>
          <button class="btn ghost" id="menu-btn">Main Menu</button>
        </div>
        <div class="restart-votes" id="restart-votes"></div>
        <div class="subtitle">Restart needs every player's vote — Main Menu dissolves the lobby</div>
      </div>`;
    (this.root.querySelector('#again-btn') as HTMLElement).onclick = () => {
      this.onRestartVote();
      (this.root.querySelector('#again-btn') as HTMLButtonElement).disabled = true;
    };
    (this.root.querySelector('#menu-btn') as HTMLElement).onclick = () => this.onMainMenu();
  }

  setRestartVotes(votes: number, needed: number): void {
    const el = this.root.querySelector('#restart-votes');
    if (el) el.textContent = `Try Again: ${votes}/${needed}`;
  }

  /** Skill tree overlay. inGame=true renders over the HUD. */
  skillTree(profile: ProfileView, inGame: boolean): void {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const branches = ['combat', 'engineering', 'economy'] as const;
    overlay.innerHTML = `
      <div class="skill-panel">
        <h2>Skill Tree</h2>
        <div class="skill-points">${profile.skillPoints} skill points</div>
        <div class="skill-branches">
          ${branches.map(br => `
            <div class="skill-branch">
              <h3>${br}</h3>
              ${SKILLS.filter(s => s.branch === br).map(s => {
                const owned = profile.unlockedSkills.includes(s.id);
                const afford = profile.skillPoints >= s.cost;
                return `<button class="skill-node ${owned ? 'owned' : afford ? '' : 'unaffordable'}" data-id="${s.id}">
                  <div class="nm">${s.name}${owned ? ' ✓' : ''}</div>
                  <div class="cost">${owned ? 'Unlocked' : `${s.cost} pts`}</div>
                </button>`;
              }).join('')}
            </div>`).join('')}
        </div>
        <button class="btn ghost" id="close-skills" style="margin-top:18px">Close</button>
      </div>`;
    (inGame ? document.getElementById('hud')! : this.root).appendChild(overlay);
    for (const el of overlay.querySelectorAll('.skill-node:not(.owned):not(.unaffordable)')) {
      (el as HTMLElement).onclick = () => {
        this.onUnlockSkill((el as HTMLElement).dataset.id!);
        overlay.remove();
      };
    }
    (overlay.querySelector('#close-skills') as HTMLElement).onclick = () => overlay.remove();
  }

  clear(): void { this.root.innerHTML = ''; }

  toast(message: string): void {
    const el = document.createElement('div');
    el.className = 'error-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}
