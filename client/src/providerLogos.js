import callYatri from './assets/call-yatri.png';

const LOGOS = {
  nexcall: callYatri
};

export function providerLogo(providerKey) {
  return LOGOS[providerKey] || null;
}
