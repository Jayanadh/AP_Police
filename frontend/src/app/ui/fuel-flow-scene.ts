import { Component } from '@angular/core';

/**
 * The sign-in page's scene, on a ten-second loop: a police jeep drives up to a pump, the driver's PIN travels from the
 * phone to the pump's screen, the litres are filled, the statement updates, and the jeep drives on. With reduced
 * motion it is one still picture of the filled jeep.
 */
@Component({
  selector: 'app-fuel-flow-scene',
  template: `
    <svg
      viewBox="0 0 400 300"
      width="100%"
      role="img"
      aria-label="A police vehicle at a pump: the driver's PIN reaches the pump's screen, the litres are filled, and the statement updates."
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="ffs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3fa7a3" />
          <stop offset="0.38" stop-color="#8fcdb0" />
          <stop offset="0.72" stop-color="#f6e4b8" />
          <stop offset="1" stop-color="#fbeccb" />
        </linearGradient>
        <linearGradient id="ffs-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8ec152" />
          <stop offset="1" stop-color="#5e9e3e" />
        </linearGradient>
        <radialGradient id="ffs-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fff3c4" stop-opacity="0.9" />
          <stop offset="1" stop-color="#fff3c4" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- sky, sun and clouds -->
      <rect width="400" height="300" fill="url(#ffs-sky)" />
      <circle cx="58" cy="66" r="52" fill="url(#ffs-glow)" />
      <circle cx="58" cy="66" r="18" fill="#f9c23c" />
      <g class="clouds" fill="#fff4d6" opacity="0.8">
        <rect x="100" y="34" width="120" height="12" rx="6" />
        <rect x="140" y="52" width="80" height="9" rx="4.5" />
        <rect x="10" y="118" width="90" height="9" rx="4.5" />
      </g>

      <!-- hills, ground and road -->
      <path d="M0 196 Q70 168 150 190 T310 184 T400 178 V300 H0 Z" fill="#cfe3a8" opacity="0.75" />
      <path d="M0 214 Q120 186 250 206 T400 202 V300 H0 Z" fill="url(#ffs-ground)" />
      <rect x="0" y="236" width="400" height="22" fill="#e0d9c7" />
      <line
        x1="0"
        y1="247"
        x2="400"
        y2="247"
        stroke="#fffaf0"
        stroke-width="2"
        stroke-dasharray="14 10"
      />

      <!-- the police pump -->
      <rect x="57" y="112" width="6" height="126" rx="2" fill="#6e9f5b" />
      <path d="M36 122 H172 V112 Q172 102 162 102 H46 Q36 102 36 112 Z" fill="#f07a5a" />
      <text
        x="104"
        y="116"
        text-anchor="middle"
        font-size="8"
        font-weight="800"
        fill="#fff"
        letter-spacing="1"
      >
        POLICE PUMP
      </text>
      <rect x="80" y="150" width="40" height="88" rx="8" fill="#e8b04f" />
      <rect x="80" y="150" width="40" height="12" rx="6" fill="#d2573a" />
      <g class="pump-screen">
        <rect x="85" y="168" width="30" height="22" rx="3" fill="#1f3b4d" />
        <text
          class="screen-pin"
          x="100"
          y="182"
          text-anchor="middle"
          font-size="7.5"
          font-weight="700"
          fill="#9fe3c9"
        >
          PIN ?
        </text>
        <text
          class="screen-ok"
          x="100"
          y="182"
          text-anchor="middle"
          font-size="7.5"
          font-weight="700"
          fill="#9fe3c9"
        >
          ✓ 20 L
        </text>
      </g>
      <rect x="114" y="196" width="9" height="16" rx="3" fill="#b9802c" />
      <rect x="76" y="234" width="48" height="6" rx="2" fill="#cfc7b2" />

      <!-- the phone's PIN on its way to the pump -->
      <path
        class="signal"
        d="M206 112 Q150 92 112 166"
        fill="none"
        stroke="#ffffff"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-dasharray="1 7"
      />

      <!-- the jeep -->
      <g class="vehicle">
        <ellipse cx="218" cy="240" rx="70" ry="4" fill="#000" opacity="0.14" />
        <path
          d="M168 192 L176 166 Q178 160 186 160 H236 Q242 160 246 166 L262 192 Z"
          fill="#ffffff"
          stroke="#c9d3dc"
        />
        <path d="M182 188 L188 167 H212 V188 Z" fill="#9fd3e6" />
        <path d="M218 188 V167 H237 L251 188 Z" fill="#9fd3e6" />
        <path
          d="M150 228 V200 Q150 192 158 192 H262 L280 204 Q286 207 286 214 V228 Z"
          fill="#ffffff"
          stroke="#c9d3dc"
        />
        <rect x="150" y="204" width="136" height="9" fill="#1f4e9c" />
        <rect x="150" y="213" width="136" height="2.5" fill="#d23c3c" />
        <text
          x="214"
          y="211"
          text-anchor="middle"
          font-size="6.5"
          font-weight="800"
          fill="#ffffff"
          letter-spacing="1.2"
        >
          POLICE
        </text>
        <rect x="196" y="154" width="30" height="7" rx="2" fill="#2b2b2b" />
        <rect
          class="light-red"
          x="197.5"
          y="155.5"
          width="12.5"
          height="4"
          rx="1.5"
          fill="#ff4d4d"
        />
        <rect
          class="light-blue"
          x="212"
          y="155.5"
          width="12.5"
          height="4"
          rx="1.5"
          fill="#3d7bff"
        />
        <rect x="280" y="206" width="6" height="4" rx="1" fill="#ffd66b" />
        <circle cx="157" cy="198" r="2.5" fill="#9aa7b2" />
        <g class="wheel">
          <circle cx="178" cy="228" r="12" fill="#2b2b2b" />
          <circle cx="178" cy="228" r="5" fill="#c9d3dc" />
          <rect x="177" y="217" width="2" height="22" fill="#5b6770" />
        </g>
        <g class="wheel">
          <circle cx="260" cy="228" r="12" fill="#2b2b2b" />
          <circle cx="260" cy="228" r="5" fill="#c9d3dc" />
          <rect x="259" y="217" width="2" height="22" fill="#5b6770" />
        </g>
      </g>

      <!-- the hose and the fuel running through it -->
      <g class="hose">
        <path
          d="M122 202 C142 214 140 188 156 196"
          fill="none"
          stroke="#2b2b2b"
          stroke-width="3.2"
          stroke-linecap="round"
        />
        <path
          class="flow"
          d="M122 202 C142 214 140 188 156 196"
          fill="none"
          stroke="#f9c23c"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-dasharray="3 5"
        />
      </g>

      <!-- the driver's phone with the PIN -->
      <g class="phone">
        <rect x="206" y="88" width="30" height="48" rx="6" fill="#1f3b4d" />
        <rect x="209" y="94" width="24" height="34" rx="3" fill="#fbeccb" />
        <text x="221" y="106" text-anchor="middle" font-size="6.5" font-weight="800" fill="#1f3b4d">
          PIN
        </text>
        <text
          x="221"
          y="118"
          text-anchor="middle"
          font-size="7"
          font-weight="800"
          fill="#d2573a"
          letter-spacing="0.4"
        >
          ••••••
        </text>
      </g>

      <!-- the tank filling, then the fill done -->
      <g class="gauge">
        <rect x="150" y="146" width="44" height="7" rx="3.5" fill="#ffffff" opacity="0.85" />
        <rect class="gauge-level" x="151.5" y="147.5" width="41" height="4" rx="2" fill="#2f9e6e" />
      </g>
      <g class="filled">
        <rect x="134" y="120" width="76" height="22" rx="11" fill="#2f9e6e" />
        <text x="172" y="135" text-anchor="middle" font-size="9" font-weight="800" fill="#ffffff">
          ✓ Filled 20 L
        </text>
      </g>

      <!-- the statement, updated with the fill -->
      <g class="statement">
        <rect x="298" y="24" width="88" height="80" rx="9" fill="#ffffff" opacity="0.95" />
        <text x="308" y="40" font-size="8" font-weight="800" fill="#1f3b4d">Statement</text>
        <rect x="308" y="46" width="64" height="3" rx="1.5" fill="#e3e8ee" />
        <rect class="bar" x="312" y="74" width="11" height="22" rx="2" fill="#e8b04f" />
        <rect class="bar" x="328" y="80" width="11" height="16" rx="2" fill="#e8b04f" />
        <rect class="bar" x="344" y="68" width="11" height="28" rx="2" fill="#e8b04f" />
        <rect class="bar bar-new" x="360" y="62" width="11" height="34" rx="2" fill="#f07a5a" />
        <text
          class="added"
          x="366"
          y="58"
          text-anchor="middle"
          font-size="7"
          font-weight="800"
          fill="#d2573a"
        >
          +20 L
        </text>
      </g>
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }

    svg {
      display: block;
    }

    // Each part turns and grows about its own box.
    svg * {
      transform-box: fill-box;
    }

    .clouds {
      animation: drift 24s ease-in-out infinite alternate;
    }

    .vehicle {
      animation: drive 10s ease-in-out infinite;
    }

    .wheel {
      transform-origin: center;
      animation: roll 10s ease-in-out infinite;
    }

    .light-red {
      animation: blink 0.8s steps(1) infinite;
    }

    .light-blue {
      animation: blink 0.8s steps(1) 0.4s infinite;
    }

    .phone {
      opacity: 0;
      animation: phone 10s ease-out infinite;
    }

    .signal {
      opacity: 0;
      animation: signal 10s linear infinite;
    }

    .screen-pin {
      animation: screen-pin 10s steps(1) infinite;
    }

    .screen-ok {
      opacity: 0;
      animation: screen-ok 10s steps(1) infinite;
    }

    .hose,
    .gauge {
      opacity: 0;
      animation: hose 10s ease-in-out infinite;
    }

    .flow {
      animation: flow 10s linear infinite;
    }

    .gauge-level {
      transform-origin: left center;
      animation: gauge 10s ease-in-out infinite;
    }

    .filled {
      opacity: 0;
      transform-origin: center;
      animation: filled 10s ease-out infinite;
    }

    .bar-new,
    .added {
      transform-origin: bottom center;
      animation: added 10s ease-out infinite;
    }

    @keyframes drift {
      to {
        transform: translateX(24px);
      }
    }

    @keyframes drive {
      0% {
        transform: translateX(-320px);
      }
      16%,
      84% {
        transform: translateX(0);
      }
      100% {
        transform: translateX(260px);
      }
    }

    @keyframes roll {
      0% {
        transform: rotate(-900deg);
      }
      16%,
      84% {
        transform: rotate(0deg);
      }
      100% {
        transform: rotate(720deg);
      }
    }

    @keyframes blink {
      50% {
        opacity: 0.25;
      }
    }

    @keyframes phone {
      0%,
      18% {
        opacity: 0;
        transform: translateY(8px);
      }
      23%,
      44% {
        opacity: 1;
        transform: translateY(0);
      }
      49%,
      100% {
        opacity: 0;
        transform: translateY(0);
      }
    }

    @keyframes signal {
      0%,
      24% {
        opacity: 0;
        stroke-dashoffset: 0;
      }
      26% {
        opacity: 1;
      }
      40% {
        opacity: 1;
        stroke-dashoffset: -64;
      }
      43%,
      100% {
        opacity: 0;
        stroke-dashoffset: -64;
      }
    }

    @keyframes screen-pin {
      0% {
        opacity: 1;
      }
      40% {
        opacity: 0;
      }
      86% {
        opacity: 1;
      }
    }

    @keyframes screen-ok {
      0% {
        opacity: 0;
      }
      40% {
        opacity: 1;
      }
      86% {
        opacity: 0;
      }
    }

    @keyframes hose {
      0%,
      40% {
        opacity: 0;
      }
      44%,
      76% {
        opacity: 1;
      }
      80%,
      100% {
        opacity: 0;
      }
    }

    @keyframes flow {
      0%,
      44% {
        stroke-dashoffset: 0;
      }
      74%,
      100% {
        stroke-dashoffset: -48;
      }
    }

    @keyframes gauge {
      0%,
      44% {
        transform: scaleX(0.15);
      }
      72%,
      100% {
        transform: scaleX(1);
      }
    }

    @keyframes filled {
      0%,
      72% {
        opacity: 0;
        transform: scale(0.8);
      }
      76%,
      88% {
        opacity: 1;
        transform: scale(1);
      }
      92%,
      100% {
        opacity: 0;
        transform: scale(1);
      }
    }

    @keyframes added {
      0%,
      74% {
        opacity: 0;
        transform: scaleY(0.2);
      }
      82%,
      94% {
        opacity: 1;
        transform: scaleY(1);
      }
      100% {
        opacity: 0;
        transform: scaleY(1);
      }
    }

    // One still picture: the jeep at the pump, filled, and the statement updated.
    @media (prefers-reduced-motion: reduce) {
      svg * {
        animation: none !important;
      }

      .phone,
      .signal,
      .screen-pin {
        opacity: 0;
      }

      .screen-ok,
      .hose,
      .gauge,
      .filled,
      .bar-new,
      .added {
        opacity: 1;
      }
    }
  `,
})
export class FuelFlowScene {}
