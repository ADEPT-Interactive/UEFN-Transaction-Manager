export interface ModerationRuleGroup {
  key: string;
  label: string;
  guidance: string;
  terms: readonly string[];
}

// These are intentionally review signals, not a claim to reproduce Epic's
// moderation system. Keep the terms focused enough to be useful to creators;
// the validator emits at most one warning per category for each offer.
export const MODERATION_RULE_GROUPS: readonly ModerationRuleGroup[] = [
  {
    key: 'profanity',
    label: 'profanity or abusive language',
    guidance: 'replace or soften the wording if it is player-facing',
    terms: [
      'asshole', 'bastard', 'bitch', 'bullshit', 'cock', 'cunt', 'damn',
      'dick', 'douchebag', 'fuck', 'fucker', 'fucking', 'motherfucker',
      'piss', 'prick', 'shit', 'slut', 'whore',
    ],
  },
  {
    key: 'hate_or_harassment',
    label: 'hateful, discriminatory, or harassing language',
    guidance: 'remove language that targets a person or protected group',
    terms: [
      'chink', 'faggot', 'kike', 'nigga', 'nigger', 'retard', 'retarded',
      'spic', 'tranny', 'wetback',
    ],
  },
  {
    key: 'sexual_content',
    label: 'sexual or adult content',
    guidance: 'review the wording for age-appropriate player-facing content',
    terms: [
      'blowjob', 'handjob', 'hentai', 'nude', 'nudity', 'onlyfans', 'porn',
      'pornography', 'sex', 'sexual', 'sexy',
    ],
  },
  {
    key: 'violence_or_self_harm',
    label: 'graphic violence or self-harm content',
    guidance: 'review the wording and the experience for age-rating concerns',
    terms: [
      'bloodbath', 'decapitate', 'decapitation', 'dismember', 'dismemberment',
      'gore', 'graphic violence', 'murder', 'self harm', 'self-harm', 'suicide',
      'torture',
    ],
  },
  {
    key: 'drugs_or_alcohol',
    label: 'drug, tobacco, or alcohol content',
    guidance: 'review references to regulated or age-restricted substances',
    terms: [
      'alcohol', 'beer', 'cannabis', 'cigarette', 'cocaine', 'drunk', 'heroin',
      'marijuana', 'meth', 'nicotine', 'tobacco', 'vape', 'vodka', 'weed',
    ],
  },
  {
    key: 'gambling',
    label: 'gambling or wagering language',
    guidance: 'confirm that the offer and experience do not simulate or promote gambling',
    terms: [
      'bet', 'betting', 'casino', 'gamble', 'gambling', 'jackpot', 'lottery',
      'loot box', 'poker', 'roulette', 'slot machine', 'wager', 'wagering',
    ],
  },
  {
    key: 'deceptive_or_real_world_value',
    label: 'deceptive claims or real-world value',
    guidance: 'avoid misleading guarantees, external value, and real-money reward claims',
    terms: [
      '100% guaranteed', 'cash prize', 'earn money', 'free money', 'free v-bucks',
      'free vbucks', 'guaranteed win', 'real money', 'risk free', 'risk-free',
    ],
  },
  {
    key: 'external_contact',
    label: 'external contact or off-platform direction',
    guidance: 'review requests to contact, follow, or leave the Fortnite experience',
    terms: [
      'discord', 'email me', 'follow me', 'instagram', 'join my server',
      'phone number', 'snapchat', 'telegram', 'tiktok', 'twitter', 'whatsapp',
      'youtube',
    ],
  },
];
