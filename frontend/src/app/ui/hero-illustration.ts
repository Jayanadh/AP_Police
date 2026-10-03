import { Component } from '@angular/core';

/** The welcome scene: a fuel station on a hill under a warm sky, in the reference app's style. */
@Component({
  selector: 'app-hero-illustration',
  template: `
    <svg
      viewBox="0 0 400 300"
      width="100%"
      role="img"
      aria-label="A fuel station with two pumps and a price sign"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3fa7a3" />
          <stop offset="0.38" stop-color="#8fcdb0" />
          <stop offset="0.72" stop-color="#f6e4b8" />
          <stop offset="1" stop-color="#fbeccb" />
        </linearGradient>
        <linearGradient id="hero-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8ec152" />
          <stop offset="1" stop-color="#5e9e3e" />
        </linearGradient>
        <radialGradient id="hero-sun-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fff3c4" stop-opacity="0.9" />
          <stop offset="1" stop-color="#fff3c4" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- sky -->
      <rect width="400" height="300" fill="url(#hero-sky)" />
      <circle cx="312" cy="112" r="86" fill="url(#hero-sun-glow)" />
      <circle cx="312" cy="112" r="30" fill="#f9c23c" />

      <!-- soft clouds -->
      <g fill="#fff4d6" opacity="0.8">
        <rect x="-10" y="38" width="150" height="14" rx="7" />
        <rect x="40" y="58" width="110" height="11" rx="5.5" />
        <rect x="220" y="26" width="140" height="13" rx="6.5" />
        <rect x="262" y="46" width="120" height="10" rx="5" />
        <rect x="160" y="88" width="90" height="9" rx="4.5" />
      </g>

      <!-- far hills and ground -->
      <path d="M0 196 Q70 168 150 190 T310 184 T400 178 V300 H0 Z" fill="#cfe3a8" opacity="0.75" />
      <path d="M0 214 Q120 186 250 206 T400 202 V300 H0 Z" fill="url(#hero-ground)" />

      <!-- forecourt -->
      <path d="M108 222 H384 L400 246 H92 Z" fill="#e0d9c7" />
      <path d="M92 246 H400 V252 H92 Z" fill="#cfc7b2" />

      <!-- canopy -->
      <rect x="150" y="138" width="9" height="84" rx="3" fill="#6e9f5b" />
      <rect x="344" y="138" width="9" height="84" rx="3" fill="#6e9f5b" />
      <path d="M118 142 Q128 108 170 108 H340 Q372 108 380 142 Z" fill="#f07a5a" />
      <rect x="118" y="134" width="262" height="6" fill="#8ec152" />
      <rect x="118" y="140" width="262" height="9" rx="4.5" fill="#f9d2a8" />

      <!-- pumps -->
      <ellipse cx="207" cy="224" rx="22" ry="4" fill="#000" opacity="0.12" />
      <ellipse cx="287" cy="224" rx="22" ry="4" fill="#000" opacity="0.12" />
      <g>
        <rect x="194" y="170" width="26" height="52" rx="6" fill="#e5484d" />
        <rect x="199" y="177" width="16" height="13" rx="3" fill="#bfe6e0" />
        <rect x="199" y="196" width="16" height="5" rx="2.5" fill="#fff4d6" />
        <path
          d="M220 184 q10 2 10 16"
          fill="none"
          stroke="#3a3a46"
          stroke-width="2.5"
          stroke-linecap="round"
        />
      </g>
      <g>
        <rect x="274" y="170" width="26" height="52" rx="6" fill="#f2a33a" />
        <rect x="279" y="177" width="16" height="13" rx="3" fill="#bfe6e0" />
        <rect x="279" y="196" width="16" height="5" rx="2.5" fill="#fff4d6" />
        <path
          d="M300 184 q10 2 10 16"
          fill="none"
          stroke="#3a3a46"
          stroke-width="2.5"
          stroke-linecap="round"
        />
      </g>

      <!-- price-sign pole -->
      <rect x="57" y="76" width="14" height="144" rx="4" fill="#b9473f" />
      <rect x="38" y="62" width="52" height="112" rx="11" fill="#e5484d" />
      <rect x="32" y="30" width="64" height="44" rx="10" fill="#8ec152" />
      <circle cx="64" cy="52" r="13" fill="#fff4d6" />
      <path d="M57 58 q5 -19 15 -13 q-3 13 -15 13 z" fill="#f07a5a" />
      <rect x="47" y="88" width="34" height="13" rx="3.5" fill="#bfe6e0" />
      <rect x="47" y="108" width="34" height="13" rx="3.5" fill="#bfe6e0" />
      <rect x="47" y="128" width="34" height="13" rx="3.5" fill="#bfe6e0" />
      <rect x="47" y="148" width="34" height="13" rx="3.5" fill="#fff4d6" />
      <rect x="47" y="214" width="34" height="10" rx="3" fill="#4b4b57" />

      <!-- foreground greenery -->
      <ellipse cx="352" cy="250" rx="30" ry="13" fill="#4f8f3a" />
      <path d="M376 254 q-13 -44 0 -66 q13 22 0 66 z" fill="#3f7a32" />
      <ellipse cx="22" cy="262" rx="34" ry="14" fill="#4f8f3a" />
      <ellipse cx="190" cy="268" rx="46" ry="12" fill="#6cab45" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }

    svg {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
})
export class HeroIllustration {}
