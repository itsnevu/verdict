import json, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test', 'fixtures'))
NOW = "2026-11-16T12:00:00.000Z"
def hrs_ago(h):
    import datetime
    t = datetime.datetime(2026,11,16,12,0,0) - datetime.timedelta(hours=h)
    return t.strftime('%Y-%m-%dT%H:%M:%S.000Z')
def st(name, method, complete=True, err=None):
    d={"name":name,"method":method,"fetchedAt":NOW,"complete":complete}
    if err: d["error"]=err
    return d
ok_sources=[st('dexscreener','getMarket'),st('rpc','getHolders'),st('rpc','getEarlyBuyers'),st('rpc','getContractFlags'),st('basedbot','getLaunchMeta')]
def buys(n, funders, base):
    return [{"wallet": "0x%040x" % (0xb000+i), "amountUsd": base*(1+ (i*37 % 11)/5), "fundingSource": funders[i % len(funders)]} for i in range(n)]
def addr(n): return "0x%040x" % n
def mk(name, sym, market, holders, early, contract, launch, sizevar, sources):
    return {"synthetic": True, "address": addr(name), "now": NOW, "market": market, "marketFetchedAt": NOW,
            "holders": holders, "earlyBuyers": early, "contract": contract, "launch": launch,
            "sizeVariance": sizevar, "sources": sources}
def market(sym, mc, liq, v6, v24, buys_, sells, uniq, age):
    return {"symbol": sym, "name": sym.title(), "pairAddress": "0x%040x" % (0xe000 + sum(map(ord, sym))), "priceUsd": mc/1e9,
            "mcUsd": mc, "liqUsd": liq, "vol6hUsd": v6, "vol24hUsd": v24, "tx24h": buys_+sells, "buys24h": buys_, "sellsUnused": None,
            "sells24h": sells, "uniqueWallets24h": uniq, "pairCreatedAt": hrs_ago(age)}
def clean(m):
    m.pop("sellsUnused", None); return m
funders_many = ["0x%040x" % (0xf000+i) for i in range(20)]
safe = {"honeypot": False, "sellFails": False, "lpLocked": True}
fx = {
 'rushr': mk(0xa001,'RUSHR', clean(market('RUSHR',400000,140000,400000,1200000,2600,2400,3000,60)),
             {"top10Share":0.18,"devShare":0.02,"holderCount":2400,"holderCount24hAgo":2000},
             {"buys": buys(30, funders_many, 120)}, safe, {"createdAt":hrs_ago(60),"devAddress":addr(0xd001),"launchpad":"basedbot"}, 0.6, ok_sources),
 'zolva': mk(0xa002,'ZOLVA', clean(market('ZOLVA',200000,28000,620000,8551724,1500,2500,800,20)),
             {"top10Share":0.45,"devShare":0.08,"holderCount":900,"holderCount24hAgo":1000},
             {"buys": buys(30, funders_many, 300)}, safe, {"createdAt":hrs_ago(20),"devAddress":addr(0xd002),"launchpad":"basedbot"}, 0.5, ok_sources),
 'robot': mk(0xa003,'ROBOT', clean(market('ROBOT',60000,1200,9000,30000,300,280,200,30)),
             {"top10Share":0.82,"devShare":0.70,"holderCount":140,"holderCount24hAgo":150},
             {"buys": buys(30, funders_many, 80)}, {"honeypot": False, "sellFails": False, "lpLocked": False}, {"createdAt":hrs_ago(30),"devAddress":addr(0xd003),"launchpad":"basedbot"}, 0.7, ok_sources),
 'nifty': mk(0xa004,'NIFTY', clean(market('NIFTY',500000,20000,50000,400000,800,1000,540,100)),
             {"top10Share":0.55,"devShare":0.12,"holderCount":1900,"holderCount24hAgo":2000},
             {"buys": buys(30, funders_many, 200)}, safe, {"createdAt":hrs_ago(100),"devAddress":addr(0xd004),"launchpad":"basedbot"}, 0.8, ok_sources),
 'degraded': mk(0xa005,'DGRAD', clean(market('DGRAD',300000,60000,150000,500000,900,800,700,40)),
             None, None, None, None, None,
             [st('dexscreener','getMarket'), st('rpc','getHolders',False,'holder source down'), st('basedbot','getLaunchMeta',False,'schema unverified')]),
}
for k,v in fx.items():
    json.dump(v, open(k+'.json','w'), indent=2)
print('written', list(fx))
