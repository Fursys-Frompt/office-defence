import type React from 'react';
import './concept-art.css';

const avatarSkins = [
  {
    name: '클린',
    mood: '단정하고 차분한 기본 생존자 스타일',
    colors: ['#20282c', '#f4f7f1', '#6fd7c8'],
    head: 'bob',
    cosmetic: 'pin'
  },
  {
    name: '네온',
    mood: '선명한 포인트 컬러가 있는 활동적인 스타일',
    colors: ['#1b2232', '#ff6873', '#63d8ff'],
    head: 'headset',
    cosmetic: 'band'
  },
  {
    name: '소프트',
    mood: '따뜻하고 편안한 캐주얼 스타일',
    colors: ['#6c4d3f', '#ffd38a', '#9edfb5'],
    head: 'bun',
    cosmetic: 'clip'
  },
  {
    name: '팝',
    mood: '밝고 수집 욕구를 주는 개성 있는 스타일',
    colors: ['#29334a', '#9a7fd2', '#f2c84e'],
    head: 'cap',
    cosmetic: 'stripe'
  }
];

const zombieTypes = [
  { name: '일반형', note: '가장 기본적인 압박을 주는 표준 좀비', body: 'walker' },
  { name: '질주형', note: '얇은 실루엣으로 빠른 접근이 읽히는 좀비', body: 'skitter' },
  { name: '중장형', note: '묵직한 덩치로 느리지만 강한 위협을 주는 좀비', body: 'brute' }
];

const itemGroups = [
  { name: '의자 부품', color: '#35c7bd', shape: 'chair' },
  { name: '책상 부품', color: '#e6be60', shape: 'crate' },
  { name: '파티션 소재', color: '#a7debd', shape: 'panel' },
  { name: '전력 코어', color: '#80dff0', shape: 'bolt' },
  { name: '구급 키트', color: '#f56e68', shape: 'cross' }
];

export function ConceptArtBoard() {
  return (
    <main className="concept-board">
      <header className="concept-hero">
        <div>
          <p className="concept-kicker">콘셉트 보드</p>
          <h1>개인 생존 스킨</h1>
          <p>
            아바타 차이는 취향과 개성만 표현합니다. 직업, 역할, 팀 보너스, 전투 클래스처럼 보이는 설명은 사용하지 않습니다.
          </p>
        </div>
        <div className="concept-principles" aria-label="디자인 원칙">
          <span>개인 점수 중심</span>
          <span>오피스 생존</span>
          <span>스킨 수집</span>
          <span>상단 시점</span>
        </div>
      </header>

      <section className="concept-section">
        <div className="section-heading">
          <p className="concept-kicker">아바타</p>
          <h2>위에서 내려다보는 스킨</h2>
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
          <p className="concept-kicker">크기 확인</p>
          <h2>96px, 64px, 40px, 28px</h2>
        </div>
        <div className="scale-stage">
          <div className="large-preview">
            <AvatarConcept skin={avatarSkins[1]} index={1} />
          </div>
          <div className="scale-row">
            <ScalePreview size="large" label="로비 96" />
            <ScalePreview size="thumb" label="썸네일 64" />
            <ScalePreview size="game" label="게임 40" />
            <ScalePreview size="hud" label="HUD 28" />
          </div>
        </div>
      </section>

      <section className="concept-section concept-split">
        <div>
          <div className="section-heading">
            <p className="concept-kicker">적</p>
            <h2>상단 시점 적 실루엣</h2>
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
            <p className="concept-kicker">아이템</p>
            <h2>수집 가능한 오피스 자원</h2>
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
      aria-label={`${skin.name} 상단 시점 아바타 콘셉트 ${index + 1}`}
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
