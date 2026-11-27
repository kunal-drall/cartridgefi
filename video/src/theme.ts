import { loadFont as loadJakarta } from '@remotion/google-fonts/PlusJakartaSans';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const jakarta = loadJakarta('normal', { weights: ['600', '700', '800'], subsets: ['latin'] });
const inter = loadInter('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });
const mono = loadMono('normal', { weights: ['400', '500', '700'], subsets: ['latin'] });

export const FONT = {
  display: jakarta.fontFamily,
  body: inter.fontFamily,
  mono: mono.fontFamily,
};

export const C = {
  void: '#050609',
  stage: '#0A0D14',
  glass: 'rgba(17, 21, 32, 0.72)',
  border: 'rgba(255,255,255,0.08)',
  specular: 'rgba(255,255,255,0.18)',
  text: '#F2F4F8',
  dim: '#9AA3B5',
  faint: '#5D6577',
  blue: '#4C8DFF',
  green: '#2BD48A',
  red: '#FF5C6C',
  amber: '#F5B13D',
  violet: '#A685FF',
  teal: '#3EE6C4',
};

export const FPS = 30;
export const W = 1920;
export const H = 1080;

export const PROGRAMS = {
  registry: { name: 'cartridge_registry', id: 'BXbbMC…mdKc' },
  room: { name: 'cartridge_er_room', id: 'DDZt6h…771W' },
  vault: { name: 'cartridge_vault_router', id: 'Db58xz…FuUR' },
  passport: { name: 'cartridge_passport', id: 'B9ctvY…9SMF' },
  delegation: { name: 'Delegation Program', id: 'DELeGG…aeSh' },
  permission: { name: 'Permission Program', id: 'ACLseo…Qnp1' },
};
