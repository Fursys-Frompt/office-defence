import type React from 'react';
import './concept-art.css';

const avatarSkins = [
  {
    name: 'Clean',
    mood: 'minimal, tidy, quiet',
    colors: ['#20282c', '#f4f7f1', '#6fd7c8'],
    head: 'bob',
    cosmetic: 'pin'
  },
  {
    name: 'Neon',
    mood: 'arcade, sharp, high contrast',
    colors: ['#1b2232', '#ff6873', '#63d8ff'],
    head: 'headset',
    cosmetic: 'band'
  },
  {
    name: 'Soft',
    mood: 'warm, casual, approachable',
    colors: ['#6c4d3f', '#ffd38a', '#9edfb5'],
    head: 'bun',
    cosmetic: 'clip'
  },
  {
    name: 'Pop',
    mood: 'bold, playful, collectible',
    colors: ['#29334a', '#9a7fd2', '#f2c84e'],
    head: 'cap',
    cosmetic: 'stripe'
  }
];

const zombieTypes = [
  { name: 'Walker', note: 'compact crawler, baseline pressure', body: 'walker' },
  { name: 'Skitter', note: 'thin hunter, fast flank read', body: 'skitter' },
  { name: 'Brute', note: 'front-heavy rammer, slow threat', body: 'brute' }
];

const itemGroups = [
  { name: 'Chair Parts', color: '#35c7bd', shape: 'chair' },
  { name: 'Desk Parts', color: '#e6be60', shape: 'crate' },
  { name: 'Panels', color: '#a7debd', shape: 'panel' },
  { name: 'Power Core', color: '#80dff0', shape: 'bolt' },
  { name: 'Med Kit', color: '#f56e68', shape: 'cross' }
];

export function ConceptArtBoard() {
  return (
    <main className="concept-board">
      <header className="concept-hero">
        <div>
          <p className="concept-kicker">Concept Art Board</p>
          <h1>Personal Survival Skins</h1>
          <p>
            Avatar variation is treated as taste and identity only. No jobs, roles, team bonuses, or implied
            combat classes.
          </p>
        </div>
        <div className="concept-principles" aria-label="Design principles">
          <span>solo score focus</span>
          <span>office survival</span>
          <span>skin collection</span>
          <span>head-first top view</span>
        </div>
      </header>

      <section className="concept-section">
        <div className="section-heading">
          <p className="concept-kicker">Avatars</p>
          <h2>Top-Down Head-First Skins</h2>
        </div>
        <div className="skin-grid">
          {avatarSkins.map((skin, index) => (
            <article className="skin-card" key={skin.name}>
              <AvatarConcept skin={skin} index={index} />
              <div className="skin-meta">
                <h3>{skin.name}</h3>
                <p>{skin.mood}</p>
                <div className="swatches">
                  {skin.colors.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="concept-section">
        <div className="section-heading">
          <p className="concept-kicker">Scale Check</p>
          <h2>96px, 64px, 40px, 28px</h2>
        </div>
        <div className="scale-stage">
          <div className="large-preview">
            <AvatarConcept skin={avatarSkins[1]} index={1} />
          </div>
          <div className="scale-row">
            <ScalePreview size="large" label="Lobby 96" />
            <ScalePreview size="thumb" label="Thumb 64" />
            <ScalePreview size="game" label="Game 40" />
            <ScalePreview size="hud" label="HUD 28" />
          </div>
        </div>
      </section>

      <section className="concept-section concept-split">
        <div>
          <div className="section-heading">
            <p className="concept-kicker">Enemies</p>
            <h2>Top-Down Enemy Silhouettes</h2>
          </div>
          <div className="zombie-row">
            {zombieTypes.map((zombie) => (
              <article className="zombie-card" key={zombie.name}>
                <ZombieConcept body={zombie.body} />
                <h3>{zombie.name}</h3>
                <p>{zombie.note}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <div className="section-heading">
            <p className="concept-kicker">Items</p>
            <h2>Collectible Office Resources</h2>
          </div>
          <div className="item-grid">
            {itemGroups.map((item) => (
              <article className="item-tile" key={item.name}>
                <ItemConcept item={item} />
                <span>{item.name}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function AvatarConcept({
  skin,
  index
}: {
  skin: (typeof avatarSkins)[number];
  index: number;
}) {
  const [hair, cloth, accent] = skin.colors;

  return (
    <div
      className={`avatar-concept avatar-${skin.head} cosmetic-${skin.cosmetic}`}
      style={{ '--hair': hair, '--cloth': cloth, '--accent': accent } as React.CSSProperties}
      aria-label={`${skin.name} top-down avatar concept ${index + 1}`}
    >
      <span className="top-shadow" />
      <span className="top-body">
        <span className="body-collar" />
        <span className="body-accent" />
      </span>
      <span className="top-arm left" />
      <span className="top-arm right" />
      <span className="top-head">
        <span className="hair-base" />
        <span className="hair-shape" />
        <span className="hair-highlight" />
        <span className="head-cosmetic" />
      </span>
    </div>
  );
}

function ScalePreview({ size, label }: { size: 'large' | 'thumb' | 'game' | 'hud'; label: string }) {
  return (
    <div className="scale-preview">
      <div className={`scale-avatar ${size}`}>
        <AvatarConcept skin={avatarSkins[1]} index={1} />
      </div>
      <span>{label}</span>
    </div>
  );
}

function ZombieConcept({ body }: { body: string }) {
  return (
    <div className={`enemy-concept enemy-${body}`}>
      <span className="enemy-shadow" />
      <span className="enemy-core" />
      <span className="enemy-shell" />
      <span className="enemy-limb limb-a" />
      <span className="enemy-limb limb-b" />
      <span className="enemy-limb limb-c" />
      <span className="enemy-limb limb-d" />
      <span className="enemy-mark mark-a" />
      <span className="enemy-mark mark-b" />
    </div>
  );
}

function ItemConcept({ item }: { item: (typeof itemGroups)[number] }) {
  return (
    <div className={`item-concept item-${item.shape}`} style={{ '--item': item.color } as React.CSSProperties}>
      <span className="item-mark" />
    </div>
  );
}
