import { EntitlementItem, BundleOffer } from '../types/entitlement';

export function parseVerseCode(verseCode: string): {
  entitlements: EntitlementItem[];
  bundles: BundleOffer[];
} {
  const entitlements: EntitlementItem[] = [];
  const bundles: BundleOffer[] = [];

  try {
    // 1. Extract Info blocks (e.g. EntitlementInfo or ManagedEntitlementInfo)
    const infoMap = new Map<string, { name: string; description: string; shortDescription: string }>();
    
    // Find info module block
    const infoSectionMatch = verseCode.match(/(?:[a-zA-Z0-9_]*EntitlementInfo|[a-zA-Z0-9_]*Info)<public>\s*:=\s*module:\s*\n([\s\S]*?)(?=(?:[a-zA-Z0-9_]*Entitlements<public>)|$)/i);
    if (infoSectionMatch) {
      const infoContent = infoSectionMatch[1];
      const itemBlocks = infoContent.split(/\n\s{4}([a-zA-Z0-9_]+)<public>\s*:=\s*module:/);
      for (let i = 1; i < itemBlocks.length; i += 2) {
        const key = itemBlocks[i].trim();
        const block = itemBlocks[i + 1] || '';
        
        const nameMatch = block.match(/Name<public><localizes>:message\s*=\s*"([^"]*)"/);
        const descMatch = block.match(/Description<public><localizes>:message\s*=\s*"([^"]*)"/);
        const shortDescMatch = block.match(/ShortDescription<public><localizes>:message\s*=\s*"([^"]*)"/);

        infoMap.set(key.toLowerCase(), {
          name: nameMatch ? nameMatch[1] : key,
          description: descMatch ? descMatch[1] : '',
          shortDescription: shortDescMatch ? shortDescMatch[1] : '',
        });
      }
    }

    // 2. Extract Prices (e.g. TransactionPrices or ManagedTransactionPrices)
    const priceMap = new Map<string, number>();
    const pricesSectionMatch = verseCode.match(/(?:[a-zA-Z0-9_]*TransactionPrices|[a-zA-Z0-9_]*Prices)<public>\s*:=\s*module:\s*\n([\s\S]*?)(?=(?:[a-zA-Z0-9_]*Offers<public>)|$)/i);
    if (pricesSectionMatch) {
      const priceLines = pricesSectionMatch[1].split('\n');
      for (const line of priceLines) {
        const priceMatch = line.match(/([a-zA-Z0-9_]+)<public>\s*:\s*float\s*=\s*([0-9.]+)/);
        if (priceMatch) {
          priceMap.set(priceMatch[1].toLowerCase(), parseFloat(priceMatch[2]));
        }
      }
    }

    // 3. Extract Entitlements (e.g. Entitlements or ManagedEntitlements)
    const entSectionMatch = verseCode.match(/(?:[a-zA-Z0-9_]*Entitlements)<public>\s*:=\s*module:\s*\n([\s\S]*?)(?=(?:[a-zA-Z0-9_]*Prices<public>)|(?:[a-zA-Z0-9_]*TransactionPrices<public>)|(?:[a-zA-Z0-9_]*Offers<public>)|$)/i);
    if (entSectionMatch) {
      const entContent = entSectionMatch[1];
      // Match classes inheriting from basic_entitlement or entitlement
      const classRegex = /([a-zA-Z0-9_]+)_entitlement<public>\s*:=\s*class<concrete>\([^)]+\):\s*\n([\s\S]*?)(?=(?:[a-zA-Z0-9_]+_entitlement<public>)|$)/gi;
      let match;
      while ((match = classRegex.exec(entContent)) !== null) {
        const verseKey = match[1].trim();
        const body = match[2];

        const iconMatch = body.match(/Icon<override>:texture\s*=\s*([^\n#]+)/);
        const paidRandomMatch = body.match(/PaidRandomItem<override>:logic\s*=\s*(true|false)/i);
        const paidAreaMatch = body.match(/PaidArea<override>:logic\s*=\s*(true|false)/i);
        const consumableMatch = body.match(/Consumable<override>:logic\s*=\s*(true|false)/i);
        const maxCountMatch = body.match(/MaxCount<override>:int\s*=\s*([0-9]+)/);
        const consequentialMatch = body.match(/ConsequentialToGameplay<override>:logic\s*=\s*(true|false)/i);

        const infoKey = verseKey.replace(/_/g, '').toLowerCase();
        let matchedInfo = infoMap.get(verseKey.toLowerCase());
        if (!matchedInfo) {
          // Search loose match
          for (const [k, v] of infoMap.entries()) {
            if (k.replace(/_/g, '') === infoKey) {
              matchedInfo = v;
              break;
            }
          }
        }

        let price = priceMap.get(verseKey.toLowerCase()) || 100;
        if (!priceMap.has(verseKey.toLowerCase())) {
          for (const [k, v] of priceMap.entries()) {
            if (k.replace(/_/g, '') === infoKey) {
              price = v;
              break;
            }
          }
        }

        const isConsumable = consumableMatch ? consumableMatch[1].toLowerCase() === 'true' : false;
        const isPaidArea = paidAreaMatch ? paidAreaMatch[1].toLowerCase() === 'true' : false;
        const isPaidRandom = paidRandomMatch ? paidRandomMatch[1].toLowerCase() === 'true' : false;
        const isConsequential = consequentialMatch ? consequentialMatch[1].toLowerCase() === 'true' : true;
        const maxCount = maxCountMatch ? parseInt(maxCountMatch[1], 10) : (isConsumable ? 1 : 1);

        entitlements.push({
          id: `ent-${verseKey}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          verseKey: verseKey,
          name: matchedInfo?.name || verseKey,
          shortDescription: matchedInfo?.shortDescription || '',
          description: matchedInfo?.description || '',
          priceVBucks: price,
          itemType: isConsumable ? 'consumable' : 'durable',
          maxCount: maxCount,
          autoConsume: isConsumable,
          iconTexture: iconMatch ? iconMatch[1].trim() : `EntitlementIcons.${verseKey}`,
          flags: {
            paidRandomItem: isPaidRandom,
            paidRandomItemOdds: isPaidRandom ? 'Disclosed in island details' : '',
            paidArea: isPaidArea,
            consequentialToGameplay: isConsequential,
          },
          ageAndRegion: {
            enabled: false,
            minAge: 0,
            allowedCountryCodes: [],
            disallowedCountryCodes: [],
          },
          actionHook: {
            type: 'signal_event',
            eventName: `${verseKey}_PurchasedEvent`,
          },
          cancelHook: {
            notifyPlayer: false,
          },
          rejoinHook: {
            autoRestore: !isConsumable,
          },
          triggers: {
            generateButtonBinding: isPaidArea,
            buttonDeviceName: isPaidArea ? `${verseKey}_Buttons` : undefined,
            generateZoneBinding: isPaidArea,
            mutatorZoneName: isPaidArea ? `${verseKey}_Zones` : undefined,
            generateAsyncListener: false,
          },
        });
      }
    }
  } catch (err) {
    console.error('Error parsing Verse file:', err);
  }

  return { entitlements, bundles };
}
