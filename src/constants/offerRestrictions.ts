export const EPIC_PLATFORM_FAMILIES = [
  'Android',
  'iOS',
  'macOS',
  'Nintendo',
  'PlayStation',
  'Windows',
  'Xbox',
  'Luna',
  'GeForceNow',
] as const;

export type EpicPlatformFamily = typeof EPIC_PLATFORM_FAMILIES[number];

// ISO alpha-2 country and dependent-territory codes represented by the local
// flag-icons package. Group/placeholder flags and the unofficial XK code are
// intentionally excluded; Epic expects ISO-3166-1 alpha-2 values here.
const FLAG_COUNTRY_CODES = `
ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz
ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr
ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo
jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr
ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro
rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv
tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw
`.trim().split(/\s+/).filter(Boolean);

export const COUNTRY_CODE_OPTIONS = FLAG_COUNTRY_CODES.map(code => code.toUpperCase()).sort();

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function getCountryName(countryCode: string): string {
  return countryNames.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
}

export const COUNTRY_PICKER_OPTIONS = COUNTRY_CODE_OPTIONS
  .map(code => ({ code, name: getCountryName(code) }))
  .sort((left, right) => left.name.localeCompare(right.name));
