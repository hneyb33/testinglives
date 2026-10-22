import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: 22,
    height: 22,
    ...props,
  };
}

export function IconHome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

export function IconIncome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 17l5.5-5.5 4 4L21 7" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

export function IconTeam(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M15.5 14.6c2.6.2 4.4 1.8 5 4.4" />
    </svg>
  );
}

export function IconShare(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="m8.3 10.8 7.4-4.6" />
      <path d="m8.3 13.2 7.4 4.6" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20.5c.8-3.8 3.7-6 7.5-6s6.7 2.2 7.5 6" />
    </svg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4l16 16" />
      <path d="M10.6 5.9A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.6M6.6 6.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function IconGift(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v8h14v-8" />
      <path d="M12 8v12" />
      <path d="M12 8c-1.5 0-4.5-.3-4.5-2.2C7.5 4.3 8.7 3.5 9.8 3.5c1.7 0 2.2 2.3 2.2 4.5Zm0 0c1.5 0 4.5-.3 4.5-2.2 0-1.5-1.2-2.3-2.3-2.3-1.7 0-2.2 2.3-2.2 4.5Z" />
    </svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
      <path d="M12 14.5v2" />
    </svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

export function IconDeposit(props: IconProps) {
  return (
    <svg {...base(props)} width={24} height={24}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8" />
      <path d="m8.5 11.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

export function IconWithdraw(props: IconProps) {
  return (
    <svg {...base(props)} width={24} height={24}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16V8" />
      <path d="m8.5 12.5 3.5-3.5 3.5 3.5" />
    </svg>
  );
}

export function IconRecords(props: IconProps) {
  return (
    <svg {...base(props)} width={24} height={24}>
      <path d="M7 3.5h10a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M9 8.5h6" />
      <path d="M9 12h6" />
      <path d="M9 15.5h4" />
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <svg {...base(props)} width={24} height={24}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V9h1.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H19v1.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 16.5Z" />
      <circle cx="16" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" transform="translate(1,1)" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3Z" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)} width={18} height={18}>
      <path d="m9 5 7 7-7 7" transform="translate(-2,-2) scale(0.9)" />
    </svg>
  );
}

export function IconBack(props: IconProps) {
  return (
    <svg {...base(props)} width={22} height={22}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)} width={20} height={20}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconBank(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m3 9 9-5.5L21 9" />
      <path d="M4 9.5h16" />
      <path d="M5.5 9.5V18M9.8 9.5V18M14.2 9.5V18M18.5 9.5V18" />
      <path d="M3.5 20.5h17" />
    </svg>
  );
}

export function IconHeadset(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 13.5v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="3.5" y="13" width="4" height="6" rx="1.6" />
      <rect x="16.5" y="13" width="4" height="6" rx="1.6" />
      <path d="M19 19a3 3 0 0 1-3 2.5h-3" />
    </svg>
  );
}

export function IconTelegram(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M21.7 4.3 18.5 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.6.6-1.2.6l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.7 13.7.8 12.2c-1.1-.3-1.1-1 .2-1.5L20 3.4c.9-.3 1.8.2 1.7.9Z" />
    </svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.6" r="0.4" fill="currentColor" />
    </svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13.5 6 9.5" />
      <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 5 6v5.5c0 4.4 2.9 7.6 7 9.5 4.1-1.9 7-5.1 7-9.5V6Z" />
      <path d="m9 11.8 2.2 2.2 4-4.2" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
      <path d="M17 8l4 4-4 4" />
      <path d="M21 12H9.5" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3.5V8h-4.5" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)} width={18} height={18}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)} width={18} height={18}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.4 2" />
    </svg>
  );
}
