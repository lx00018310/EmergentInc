import React from 'react';

export interface TechGoggleAvatarProps {
  className?: string;
  variant?: 'compact' | 'hero';
}

export const TechGoggleAvatar: React.FC<TechGoggleAvatarProps> = ({ className = '', variant = 'compact' }) => {
  const isHero = variant === 'hero';

  return (
    <div className={`qj-tech-avatar ${isHero ? 'qj-tech-avatar-hero' : ''} ${className}`} aria-label="极地双筒机能灵偶">
      <svg
        viewBox={isHero ? "0 0 240 280" : "0 0 64 76"}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <radialGradient id={`skyCold-${variant}`} cx="50%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#1a3556" />
            <stop offset="60%" stopColor="#0d213a" />
            <stop offset="100%" stopColor="#071322" />
          </radialGradient>
          <linearGradient id={`pastelHair-${variant}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="50%" stopColor="#fbcfe8" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
          <linearGradient id={`cyanLens-${variant}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="40%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#0369a1" />
          </linearGradient>
          <radialGradient id={`goldLensRing-${variant}`} cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="45%" stopColor="#ffd700" />
            <stop offset="80%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#92400e" />
          </radialGradient>
          <filter id={`lensGlow-${variant}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {isHero ? (
          /* 大片级 Hero 主展台视窗渲染 (240 x 280) */
          <>
            <rect width="240" height="280" fill={`url(#skyCold-${variant})`} />

            {/* 背景极地经纬天青刻度标尺 */}
            <circle cx="120" cy="115" r="95" stroke="#00e5ff" strokeWidth="1" strokeDasharray="6 4" opacity="0.35" />
            <circle cx="120" cy="115" r="110" stroke="#d97706" strokeWidth="0.8" opacity="0.25" />
            <line x1="120" y1="10" x2="120" y2="26" stroke="#00e5ff" strokeWidth="1" opacity="0.6" />
            <line x1="120" y1="204" x2="120" y2="220" stroke="#00e5ff" strokeWidth="1" opacity="0.6" />
            <line x1="15" y1="115" x2="31" y2="115" stroke="#d97706" strokeWidth="1" opacity="0.6" />
            <line x1="209" y1="115" x2="225" y2="115" stroke="#d97706" strokeWidth="1" opacity="0.6" />

            {/* 浅樱粉太空棉防寒机能服（图3同款） */}
            <path d="M35 280 C55 210, 85 190, 120 190 C155 190, 185 210, 205 280 Z" fill="#fbcfe8" />
            {/* 白天鹅绒领与粉红绒圈 */}
            <path d="M80 190 C95 180, 145 180, 160 190 C165 200, 155 210, 120 210 C85 210, 75 200, 80 190 Z" fill="#f472b6" />
            {/* 纯金金属拉链与扣件 */}
            <path d="M102 165 L98 215 C112 225, 128 225, 142 215 L138 165 Z" fill="#ffffff" stroke="#d97706" strokeWidth="1.8" />
            <line x1="120" y1="170" x2="120" y2="280" stroke="#d97706" strokeWidth="2.5" />
            <circle cx="120" cy="180" r="3.5" fill="#fef08a" stroke="#d97706" strokeWidth="1" />
            <circle cx="120" cy="205" r="3" fill="#fef08a" />

            {/* 白皙面容与果冻粉唇 */}
            <path d="M92 120 C92 170, 148 170, 148 120 Z" fill="#ffedd5" />
            <ellipse cx="120" cy="155" rx="8" ry="4" fill="#fb7185" />
            <line x1="114" y1="155" x2="126" y2="155" stroke="#e11d48" strokeWidth="1" />

            {/* 粉蓝渐变蓬松发型 */}
            <path
              d="M70 128 C68 70, 88 50, 120 50 C152 50, 172 70, 170 128 C170 156, 160 165, 160 165 C152 135, 152 120, 152 120 C140 128, 100 128, 88 120 C88 120, 88 135, 80 165 C80 165, 70 156, 70 128 Z"
              fill={`url(#pastelHair-${variant})`}
            />

            {/* 白色高分子陶瓷头戴支架与传感器 */}
            <path d="M68 85 C68 42, 172 42, 172 85" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
            <rect x="62" y="85" width="12" height="38" rx="6" fill="#ffffff" stroke="#d97706" strokeWidth="1.5" />
            <rect x="166" y="85" width="12" height="38" rx="6" fill="#ffffff" stroke="#d97706" strokeWidth="1.5" />
            <circle cx="68" cy="104" r="3" fill="#00e5ff" />
            <circle cx="172" cy="104" r="3" fill="#00e5ff" />

            {/* 核心灵魂：双筒复古未来白金天青目镜 */}
            <g filter={`url(#lensGlow-${variant})`}>
              {/* 左目镜筒 */}
              <circle cx="95" cy="105" r="26" fill="#ffffff" stroke={`url(#goldLensRing-${variant})`} strokeWidth="4.5" />
              <circle cx="95" cy="105" r="19" fill={`url(#cyanLens-${variant})`} />
              <ellipse cx="90" cy="99" rx="6" ry="3.5" fill="#ffffff" opacity="0.9" />
              <path d="M85 110 C90 114, 102 114, 106 109" stroke="#ffffff" strokeWidth="1.2" opacity="0.75" />

              {/* 右目镜筒 */}
              <circle cx="145" cy="105" r="26" fill="#ffffff" stroke={`url(#goldLensRing-${variant})`} strokeWidth="4.5" />
              <circle cx="145" cy="105" r="19" fill={`url(#cyanLens-${variant})`} />
              <ellipse cx="140" cy="99" rx="6" ry="3.5" fill="#ffffff" opacity="0.9" />
              <path d="M135 110 C140 114, 152 114, 156 109" stroke="#ffffff" strokeWidth="1.2" opacity="0.75" />

              {/* 中间双筒连接纯金金属桥 */}
              <rect x="117" y="101" width="6" height="8" rx="2" fill="#d97706" stroke="#fef08a" strokeWidth="0.8" />
            </g>
          </>
        ) : (
          /* 名录卡片 Compact 渲染 (64 x 76) */
          <>
            <rect width="64" height="76" fill={`url(#skyCold-${variant})`} />

            {/* 蓝图经纬定位十字标 */}
            <line x1="4" y1="6" x2="8" y2="6" stroke="#00e5ff" strokeWidth="0.5" strokeOpacity="0.6" />
            <line x1="6" y1="4" x2="6" y2="8" stroke="#00e5ff" strokeWidth="0.5" strokeOpacity="0.6" />
            <line x1="56" y1="6" x2="60" y2="6" stroke="#d97706" strokeWidth="0.5" strokeOpacity="0.6" />
            <line x1="58" y1="4" x2="58" y2="8" stroke="#d97706" strokeWidth="0.5" strokeOpacity="0.6" />

            {/* 浅樱粉太空棉防寒服（图3同款） */}
            <path d="M10 76 C15 58, 24 53, 32 53 C40 53, 49 58, 54 76 Z" fill="#fbcfe8" />
            {/* 粉红毛茸绒领边 */}
            <path d="M22 53 C26 51, 38 51, 42 53 C44 56, 42 59, 32 59 C22 59, 20 56, 22 53 Z" fill="#f472b6" />
            {/* 纯金金属拉链 */}
            <line x1="32" y1="58" x2="32" y2="76" stroke="#d97706" strokeWidth="1.5" />
            <circle cx="32" cy="62" r="1.5" fill="#fef08a" />

            {/* 白皙面部与果冻粉唇 */}
            <path d="M24 34 C24 48, 40 48, 40 34 Z" fill="#ffedd5" />
            <ellipse cx="32" cy="44" rx="2.5" ry="1.2" fill="#fb7185" />
            <line x1="30.5" y1="44" x2="33.5" y2="44" stroke="#e11d48" strokeWidth="0.4" />

            {/* 粉蓝渐变波波短发 */}
            <path
              d="M18 36 C18 20, 24 14, 32 14 C40 14, 46 20, 46 36 C46 44, 43 46, 43 46 C41 38, 41 34, 41 34 C37 36, 27 36, 23 34 C23 34, 23 38, 21 46 C21 46, 18 44, 18 36 Z"
              fill={`url(#pastelHair-${variant})`}
            />

            {/* 白色头戴机械耳机与传感器支架 */}
            <path d="M17 24 C17 12, 47 12, 47 24" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="15" y="24" width="4" height="12" rx="2" fill="#ffffff" stroke="#d97706" strokeWidth="0.6" />
            <rect x="45" y="24" width="4" height="12" rx="2" fill="#ffffff" stroke="#d97706" strokeWidth="0.6" />

            {/* 核心灵魂：双筒机能白金天青目镜 */}
            <g filter="drop-shadow(0 2px 4px rgba(0,0,0,0.4))">
              <circle cx="25" cy="30" r="7.5" fill="#ffffff" stroke="#d97706" strokeWidth="1.5" />
              <circle cx="25" cy="30" r="5.5" fill={`url(#cyanLens-${variant})`} />
              <ellipse cx="23.5" cy="28.5" rx="1.8" ry="1" fill="#ffffff" opacity="0.9" />

              <circle cx="39" cy="30" r="7.5" fill="#ffffff" stroke="#d97706" strokeWidth="1.5" />
              <circle cx="39" cy="30" r="5.5" fill={`url(#cyanLens-${variant})`} />
              <ellipse cx="37.5" cy="28.5" rx="1.8" ry="1" fill="#ffffff" opacity="0.9" />

              <rect x="31" y="29" width="2" height="2" fill="#d97706" />
            </g>
          </>
        )}
      </svg>
    </div>
  );
};
