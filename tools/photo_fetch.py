#!/usr/bin/env python3
"""名画のピース(F23)の「風景の写真」を Wikimedia Commons から作る: data/photo/<id>.jpg と data/photos.json。

  python -I tools/photo_fetch.py            # WORKS のうち まだ取り込んでいないものだけ
  python -I tools/photo_fetch.py nyhavn     # 1 枚だけ取り直す
  python -I tools/photo_fetch.py --all      # 全部を取り直す

新しく取り込んだ写真は 候補(data/photos-pool.json)に入り、すぐには図録に出ない。毎週 Actions(update-art.yml → tools/art_release.py)が
候補の先頭から data/photos.json へ移す。公開済みの data/photos.json の並びは変えない。

・Wikimedia Commons の API(commons.wikimedia.org/w/api.php・鍵なし)で、ファイル名からライセンス・撮影者・撮影日・縮小画像の URL を取る。
・使うのは CC0 / パブリックドメイン / CC BY / CC BY-SA の写真だけ(ほかは止める)。CC BY 系は撮影者とライセンスの表示が条件なので、
  アプリは絵の下にいつも「撮影者・ライセンス」を出す(完成後はファイルのページへのリンクも)。画像は縮小しただけで加工しない。
・場所の名前・国・地域・背景・見どころ(日本語)は この表に書く。
・標準ライブラリ+curl。要求の間は 6 秒あける(API に負荷をかけない)。
"""
import html
import json
import re
import struct
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "photo"
INDEX = ROOT / "data" / "photos.json"
POOL = ROOT / "data" / "photos-pool.json"  # まだ公開していない候補(並び=公開する順)
UA = "photo-fetch-script/1.0 (fetches a dozen freely licensed photos for a personal app)"
WIDTH = 900
OK_LICENSE = re.compile(r"^(CC0|Public domain|CC BY(-SA)? \d)", re.I)

# 並び順=集める順。file = Commons のファイル名(File: は付けない)
WORKS = [
    {"id": "nyhavn", "file": "2018 - Nyhavn on sunset.jpg", "title": "ニューハウン(コペンハーゲン)", "country": "デンマーク", "region": "コペンハーゲン",
     "story": "17 世紀に、海から街の中心まで船を入れるために掘られた運河の港。長いあいだ船乗りの酒場が並ぶ荒っぽい界隈だった。童話作家アンデルセンは、この通りの 3 つの家に合わせて 20 年近く住んでいる。",
     "look": "切妻の家が 1 軒ずつ違う色で並ぶ。その色が運河の水に映り、木造の帆船のマストが縦の線を足す。家の幅が狭いのは、昔 間口の広さで税が決まったため、という町が北ヨーロッパには多い。"},
    {"id": "bryggen", "file": "Fassaden in Bryggen, Bergen N.jpg", "title": "ブリッゲン(ベルゲン)", "country": "ノルウェー", "region": "ベルゲン",
     "story": "中世、ハンザ同盟のドイツ商人がここに商館を構え、北の海でとれた干し鱈をヨーロッパ中へ送り出した。木造なので何度も火事で焼け、そのたびに同じ形で建て直されてきた。1979 年に世界遺産。",
     "look": "板張りの切妻の家が、少しずつ傾きながら肩を寄せ合っている。赤・黄土・白の塗り分けと、屋根の下の荷揚げ用の出っ張りを探してみる。建物の間の細い路地の奥にも、木の倉庫が続いている。"},
    {"id": "reine", "file": "Houses of Reine by Gravdalsbukta, Moskenes, Nordland, Norway, 2022 June.jpg", "title": "レーヌ(ロフォーテン諸島)", "country": "ノルウェー", "region": "ノールラン県・北極圏",
     "story": "北極圏の島々にある小さな漁村。赤い小屋は「ロルブー」と呼ばれ、冬の鱈漁の季節に各地から来た漁師が寝泊まりした。いまは多くが宿になっている。夏は太陽が沈まず、冬はオーロラが出る。",
     "look": "海からいきなり立ち上がる岩山と、その足もとに散らばる赤や白の小さな家。大きさの差がこの土地の景色のすべて。水ぎわの赤い小屋が杭の上に建ち、海にせり出しているのは、舟から直接 魚を揚げるため。"},
    {"id": "gamla-stan", "artist": "Julian Herzog", "file": "Skeppsbrokajen Gamla Stan from Skeppsholmen Stockholm 2016 01.jpg", "title": "ガムラスタン(ストックホルム旧市街)", "country": "スウェーデン", "region": "ストックホルム",
     "story": "ストックホルムは 13 世紀に、湖と海をつなぐ水路の小さな島から始まった。その島がガムラスタン(古い町)。写っている岸壁は、かつて大商人の屋敷と商船が並んだ町の表玄関だった。",
     "look": "黄土色、橙、薄い赤。北欧の町の壁の色は、低い太陽の光でいちばんきれいに見えるように選ばれている。建物の高さはそろっているのに、屋根と窓は 1 軒ずつ違う。その上に教会の塔が突き出る。"},
    {"id": "porvoo", "file": "The Red Wooden Warehouses of Porvoo.jpg", "title": "ポルヴォーの赤い倉庫", "country": "フィンランド", "region": "ウーシマー県",
     "story": "フィンランドで 2 番目に古い町。川岸の倉庫には、遠い国から船で届いた香辛料やコーヒー、ワインが積まれた。赤い色は、18 世紀の終わりにスウェーデン王の来訪に合わせて塗られたのが始まりと伝えられる。",
     "look": "同じ赤でも、1 棟ずつ少し色が違う。この赤は銅の鉱山の副産物から作る塗料で、木を守り、北欧の田舎の家の色になった。板の木目、色のあせ方、川へ下りる石の土台。近くで見るほど古さがわかる。"},
    {"id": "kirkjufell", "file": "Kirkjufell, Iceland, 20240714 1631 0713.jpg", "title": "キルキュフェットル山", "country": "アイスランド", "region": "スナイフェルスネス半島",
     "story": "名前は「教会の山」。教会の尖塔に似ているのでそう呼ばれる。高さは 463 メートル。氷河時代、まわりを流れる氷に両側から削られて、この形だけが残った。地層の縞は、何百万年ぶんの溶岩と堆積物。",
     "look": "手前の滝ごしに見るのが、この山のいちばん知られた眺め。見る角度で形がまったく変わる。木が 1 本も無いこと、草の緑と岩と水の白だけでできていることにも注目する。アイスランドの景色は、色の数がとても少ない。"},
    {"id": "colmar", "file": "Little Venice in Colmar 01.jpg", "title": "コルマールの「小さなヴェネツィア」", "country": "フランス", "region": "アルザス地方",
     "story": "ドイツとの国境に近く、歴史の中で何度も国が入れ替わった町。川沿いのこの一角は、昔は農家が小舟で野菜を市場へ運んだ場所。木の骨組みを見せる家は、石の少ないこの地方の建て方。",
     "look": "壁に浮き出た木の骨組みの模様を見比べる。斜めの材、X 字、ひし形。家ごとに違う。壁の色は、昔は住む人の職業を表したとも言われる。窓辺と橋の欄干にあふれる花も、この町の決まりごと。"},
    {"id": "burano", "file": "Burano Hausfassade Wäsche-20090315-RM-113043.jpg", "title": "ブラーノ島の家", "country": "イタリア", "region": "ヴェネツィアの潟",
     "story": "ヴェネツィアの沖に浮かぶ漁師の島。家を鮮やかな色に塗るのは、霧の深い日でも漁から戻る舟が自分の家を見分けられるように、と伝えられる。いまも壁を塗り替えるには役所に色を届け出る。レース編みでも知られる。",
     "look": "主役は壁の色と、そこに干された洗濯物。観光地の飾りではなく、毎日の暮らしがそのまま色の組み合わせになっている。鎧戸、窓枠、戸口の布。小さな面ごとに色が切り替わるのを追ってみる。"},
    {"id": "manarola", "artist": "Timothy A. Gonsalves", "file": "Manarola NW Cinque Terre Sep23 A7C 07233.jpg", "title": "マナローラ(チンクエ・テッレ)", "country": "イタリア", "region": "リグーリア州",
     "story": "断崖の続く海岸に並ぶ 5 つの村「チンクエ・テッレ」のひとつ。長いあいだ船と山道でしか行けなかった。村の人々は千年かけて崖に石垣を積み、ぶどうの段々畑を作った。1997 年に世界遺産。",
     "look": "黒い岩の上に、淡い色の家が積み木のように重なる。平らな土地が無いので、家は上へ伸びるしかなかった。村の下の斜面に引き上げられた小舟と、背後の山の段々畑まで見ると、暮らし方がわかる。"},
    {"id": "bled", "file": "Bled Island 05.jpg", "title": "ブレッド湖の島", "country": "スロベニア", "region": "ユリアン・アルプス",
     "story": "氷河が削った湖に浮かぶ、スロベニアでただ 1 つの島。島の教会へは「プレトナ」という手こぎの舟で渡り、99 段の石段を上る。教会の鐘を鳴らすと願いがかなう、という言い伝えがある。",
     "look": "湖のまん中に、木々と教会だけの小さな島がある。この写真は湖畔の丘から、森の枝ごしに見下ろしている。水の色と、背後の山の重なりの濃淡を見る。朝は霧、秋は紅葉、冬は雪で、同じ構図がまったく違う絵になる。"},
    {"id": "bruges", "file": "Rozenhoedkaai (canal) and Belfry of Bruges, Bruges, Belgium (Ank Kumar, Infosys Limited) 05.jpg", "title": "ブルージュの運河と鐘楼", "country": "ベルギー", "region": "フランドル地方",
     "story": "中世、毛織物の交易でヨーロッパ有数の豊かな町だった。ところが海へ通じる水路が砂で埋まり、町は数百年のあいだ忘れられる。そのおかげで、中世の街並みがほとんどそのまま残った。",
     "look": "運河が曲がる角から、煉瓦の家並みごしに高さ 83 メートルの鐘楼を見上げる、この町でいちばん有名な眺め。屋根の端が階段のようにぎざぎざになった切妻は、フランドルの町のしるし。"},
    {"id": "tallinn", "file": "Tallinna vanalinn päikesetõusu ajal.jpg", "title": "タリン旧市街", "country": "エストニア", "region": "タリン",
     "story": "バルト海をはさんでフィンランドの向かい。中世にはハンザ同盟の港町として栄えた。町を囲む城壁と見張りの塔が、北ヨーロッパでは珍しいほどよく残っている。1997 年に世界遺産。",
     "look": "朝もやの中から、教会の細い尖塔と、とんがり帽子のような城壁の塔が浮かび上がる。屋根の赤、壁の白、木々の緑。高台から見下ろす構図は、中世の絵地図に近い。日が昇るにつれて、もやの下の町が少しずつ現れる。"},
    # ── ここから 2026-11-15 に足した候補(先頭の 3 枚は 名画と数をそろえるために すぐ公開・残りは 毎週 2 枚ずつ) ──
    {"id": "dubrovnik", "file": "Dubrovnik as seen from Srđ - September 2017.jpg", "title": "ドゥブロヴニク旧市街", "country": "クロアチア", "region": "ダルマチア地方",
     "story": "中世から近世にかけて、海の交易で栄えた小さな共和国の都だった。ヴェネツィアと張り合い、町を囲む城壁は 2 キロ近くある。1667 年の大地震と、1991 年の戦争での砲撃という 2 度の大きな被害から、そのたびに建て直された。1979 年に世界遺産。",
     "look": "背後の山の上から見下ろしている。城壁の中に橙色の屋根がぎっしり詰まり、その外は すぐ海。屋根の色に明るい所と くすんだ所があるのは、新しい瓦と古い瓦の違い。左上の緑の島はロクルム島。"},
    {"id": "geiranger", "file": "Fiordo de Geiranger desde Flydalsjuvet, Noruega, 2019-09-07, DD 59.jpg", "title": "ガイランゲルフィヨルド", "country": "ノルウェー", "region": "ムーレ・オ・ロムスダール県",
     "story": "フィヨルドは、氷河が深く削った谷に海が入り込んだ入り江。ここは長さが 15 キロほどあり、両岸は 1,000 メートルを超える山。2005 年に世界遺産になった。いちばん奥の小さな村には、夏になると大きな客船がやって来る。",
     "look": "谷の断面が U の字になっているのが、氷河が削った しるし。水面に浮かぶ白い客船を見つけると、まわりの山の大きさがわかる。手前の岩の張り出しは、この眺めで知られる展望の場所。"},
    {"id": "neuschwanstein", "file": "Neuschwanstein Castle 2024.jpg", "title": "ノイシュヴァンシュタイン城", "country": "ドイツ", "region": "バイエルン州",
     "story": "バイエルンの王ルートヴィヒ 2 世が、中世の騎士の城と、ワーグナーのオペラの世界にあこがれて 1869 年に建て始めた。王は 1886 年に謎の死をとげ、城は未完成のまま残った。王の死から数週間後には、もう観光客に公開されている。",
     "look": "ふもとの村から見上げている。白い壁と細い塔が、暗い針葉樹の山と岩を背にして浮かぶ。中世の城に見えるが、建てられたのは鉄道も電信もある 19 世紀。守るためではなく、眺めるための城。"},
    {"id": "mont-saint-michel", "file": "Mont St Michel at sunrise.jpg", "title": "モン・サン=ミシェル", "country": "フランス", "region": "ノルマンディー地方",
     "story": "8 世紀の初め、近くの町の司教が、夢に現れた大天使ミカエルのお告げで岩山に礼拝堂を建てたのが始まりと伝えられる。のちに修道院になり、百年戦争では要塞、フランス革命のあとは監獄として使われた。1979 年に世界遺産。",
     "look": "日の出の光が、島の東側だけを橙色に染めている。この湾は潮の満ち引きの差がとても大きく、写真は潮が引いたときのもの。下から、村、城壁、修道院、尖塔と積み重なる形を、水に映った姿と見比べる。"},
    {"id": "oia", "file": "1000 Three domes of Oia in Santorini Photo by Giles Laurent.jpg", "title": "イアの青い丸屋根(サントリーニ島)", "country": "ギリシャ", "region": "キクラデス諸島",
     "story": "サントリーニ島は、3,600 年ほど前の巨大な噴火で島のまん中が海に沈み、三日月の形に残った。村は、その断崖のふちに建っている。壁を白く塗るのは、石灰で強い日ざしをはね返すため。",
     "look": "青い丸屋根は教会。白い壁と青い屋根は、海と空の色にそろえたように見える。海の向こうの陸も、同じ噴火でできた断崖の続き。崖の地層の赤と黒は、積み重なった溶岩と火山灰。"},
    {"id": "amsterdam", "file": "Colorful canal houses at golden hour in Damrak avenue Amsterdam the Netherlands.jpg", "title": "ダムラックの運河の家(アムステルダム)", "country": "オランダ", "region": "アムステルダム",
     "story": "アムステルダムは湿地に造られた町で、家は地中に打ち込んだ何本もの木の杭の上に建っている。17 世紀、海の交易で栄えた商人たちが、運河沿いに間口の狭い家を並べた。少し傾いた家が多いのは、杭が年月で沈むため。",
     "look": "家が水の中から直接 立ち上がっている。屋根の正面の飾り(破風)の形が 1 軒ずつ違うのを見比べる。夕日の当たる壁と、うしろの暗い雲の差が強い。奥の塔は、町でいちばん古い教会の鐘楼。"},
    {"id": "matterhorn", "file": "Matterhorn, March 2019 (01).jpg", "title": "マッターホルン", "country": "スイス(イタリアとの国境)", "region": "ヴァレー州・ツェルマット",
     "story": "高さ 4,478 メートル。アルプスの名高い山の中で、最後まで登られずに残った山のひとつ。1865 年にイギリスのウィンパーの隊が初めて頂上に立ったが、下りる途中で 7 人のうち 4 人が命を落とした。",
     "look": "四角錐の形は、氷河が四方から山を削って残ったもの。頂は少しだけ片側に傾いている。雪の付かない急な岩の面と、白い肩の線を見る。山の上に広がる雲が、山の大きさを さらに強めている。"},
    {"id": "annecy", "file": "Palais de l'Isle in Annecy 11.jpg", "title": "パレ・ド・リル(アヌシー)", "country": "フランス", "region": "オート=サヴォワ県",
     "story": "アルプスのふもとの町アヌシーで、川の中州に建つ 12 世紀からの石の館。領主の住まい、裁判所、貨幣を造る所、そして長いあいだ牢獄として使われてきた。川の水は、すぐ上流のアヌシー湖から流れてくる。",
     "look": "館は船のへさきのような三角の形で、流れを 2 つに分けている。夕暮れの青い空の下で、岸の店の明かりが水に長く映る。灰色の石の館と、両岸の やわらかい色の家の違いも見る。"},
    {"id": "seljalandsfoss", "file": "Seljalandsfoss, Suðurland, Islandia, 2014-08-16, DD 201-203 HDR.JPG", "title": "セリャラントスフォスの滝", "country": "アイスランド", "region": "南部",
     "story": "落差はおよそ 60 メートル。氷河から流れ出た川が、大昔の海岸だった崖から落ちている。崖の下が大きくえぐれているので、滝の裏側へ歩いて回り込める。",
     "look": "滝の裏の岩の くぼみから、夕日の方角を見ている。岩の天井が、景色を囲む額ぶちになる。水の幕の向こうに、平らな土地がどこまでも続く。岩に付いた苔の緑と、夕焼けの橙の組み合わせを見る。"},
    {"id": "riga", "file": "House of Blackheads and St. Peter's Church Tower, Riga, Latvia - Diliff.jpg", "title": "ブラックヘッドの会館(リガ)", "country": "ラトビア", "region": "リガ旧市街",
     "story": "14 世紀に建てられ、のちに「ブラックヘッド」と呼ばれる 独身の商人たちの組合の集会所になった。第二次世界大戦で破壊され、残った壁も戦後に取り壊された。いまの建物は、町の 800 年の節目に合わせて 1999 年に元の姿で建て直したもの。",
     "look": "階段のように上へすぼまる正面の壁に、彫像と時計と飾りがびっしり付いている。日が沈んだあとの深い青の空に、明かりを受けた煉瓦の橙が映える。左の細い緑の塔は聖ペテロ教会。"},
    {"id": "eilean-donan", "file": "Eilean Donan Castle, Scotland - Jan 2011.jpg", "title": "アイリーン・ドナン城", "country": "イギリス(スコットランド)", "region": "ハイランド地方",
     "story": "3 つの入り江が出会う所の小島に、13 世紀に築かれた城。1719 年の反乱でスペインの兵が立てこもり、イギリス海軍の砲撃で崩された。それから 200 年ほど廃墟のままだったが、20 世紀の初めに建て直され、石の橋もそのとき架けられた。",
     "look": "冬の朝の低い日ざしが、城の壁だけを金色に照らしている。潮が引いた浅い水に、城が逆さに映る。右へ伸びるアーチの橋と、遠くの雪の山まで、横に長く目を動かしてみる。"},
    {"id": "funes", "artist": "Wolfgang Moroder", "file": "Villnöß Johanniskapelle mit Geisler.jpg", "title": "フネス谷の聖ヨハネ礼拝堂", "country": "イタリア", "region": "南チロル・ドロミーティ",
     "story": "18 世紀の中ごろに、牧草地のまん中に建てられた小さな礼拝堂。この地方は第一次世界大戦までオーストリアの領土で、いまもドイツ語を話す人が多い。うしろの岩山を含むドロミーティの山々は、2009 年に世界遺産になった。",
     "look": "玉ねぎの形の屋根をのせた塔は、アルプスの東側の教会に多い形。広い草地に礼拝堂が 1 つだけ、という余白がこの景色のすべて。左の奥には、のこぎりの歯のような灰色の岩の峰が並ぶ。"},
    {"id": "prague", "file": "Vltava river in Prague.jpg", "title": "ヴルタヴァ川と橋(プラハ)", "country": "チェコ", "region": "プラハ",
     "story": "町のまん中を流れるヴルタヴァ川は、ドイツ語の名前「モルダウ」でも知られ、スメタナの曲の題になった。川に架かる橋のうち いちばん古いカレル橋は、14 世紀に造り始めた石の橋で、いまも歩いて渡れる。",
     "look": "川が曲がりながら、いくつもの橋をくぐっていく。橋のアーチの並びが、奥へ行くほど小さく重なる。手前の建物の緑の丸屋根は、銅が年月で変わった色。秋の黄色い木々が、川の中州を埋めている。"},
    {"id": "kotor", "file": "Bay of Kotor from Lepetani's road.jpg", "title": "コトル湾", "country": "モンテネグロ", "region": "アドリア海沿岸",
     "story": "アドリア海が、高い山の間へ 30 キロ近く入り込んでいる。北欧のフィヨルドに似ているが、氷河ではなく、川の谷が海に沈んでできた。沿岸の町は、長くヴェネツィア共和国の支配のもとで、船乗りの町として栄えた。",
     "look": "手前に、石の屋根の小さな教会と、白と黒の縞の灯台。そのすぐ下から深い青の水が広がる。向こう岸の右に見える家並みは、船長たちの町ペラスト。沖には、教会の建つ小さな島が浮かぶ。"},
    {"id": "sintra", "file": "Sintra Portugal Palácio da Pena-01.jpg", "title": "ペーナ宮殿(シントラ)", "country": "ポルトガル", "region": "リスボン近郊",
     "story": "山の上にあった修道院は、1755 年のリスボン大地震で廃墟になった。19 世紀に、女王の夫フェルナンド 2 世がそれを買い取り、夏の離宮に造り変えた。中世の城、イスラムの宮殿、ポルトガルの古い様式を、好きなように混ぜている。1995 年に世界遺産。",
     "look": "赤い部分が、もとの修道院を直した所。黄色い部分が、新しく建て増した所。丸屋根、時計塔、城壁のぎざぎざと、ひとつの建物の中で形が次々に替わる。おとぎ話の城の、もとになった姿のひとつ。"},
]


def get(url, binary=False):
    time.sleep(6)
    raw = subprocess.run(["curl", "-sS", "-f", "-L", "-m", "90", "-A", UA, url], check=True, capture_output=True).stdout
    return raw if binary else json.loads(raw.decode("utf-8"))


def jpeg_size(b):
    i = 2
    while i < len(b):
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return w, h
        if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    raise ValueError("not a JPEG")


def plain(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", str(s) if s is not None else ""))).strip()


def build(w):
    q = urllib.parse.urlencode({"action": "query", "titles": "File:" + w["file"], "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": WIDTH, "format": "json"})
    page = next(iter(get("https://commons.wikimedia.org/w/api.php?" + q)["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    em = {k: plain(v.get("value", "")) for k, v in ii.get("extmetadata", {}).items()}
    lic = em.get("LicenseShortName", "")
    assert OK_LICENSE.match(lic), f"{w['id']}: license {lic!r}"
    raw = get(ii["thumburl"], binary=True)
    width, height = jpeg_size(raw)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{w['id']}.jpg").write_bytes(raw)
    ym = re.search(r"(?:19|20)\d\d", em.get("DateTimeOriginal", "")) or re.search(r"(?:19|20)\d\d", em.get("DateTime", ""))
    year = ym.group(0) if ym else ""
    artist = w.get("artist") or em.get("Artist", "")[:80] or "Wikimedia Commons の投稿者"  # 表記が長い / 余計な語が付く人は WORKS の artist で上書き
    print(f"{w['id']}: {width}x{height} {len(raw) // 1024}KB {lic} / {artist} / {year}".encode("ascii", "replace").decode())
    return {"id": w["id"], "kind": "photo", "img": f"data/photo/{w['id']}.jpg", "w": width, "h": height, "title": w["title"], "artist": artist, "country": w["country"], "region": w["region"],
            "year": f"{year} 年" if year else "", "story": w["story"], "look": w["look"], "page": ii["descriptionurl"], "license": lic, "credit": f"写真: {artist}({lic}・Wikimedia Commons)"}


def load(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def save(path, items):
    path.write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


def main():
    args = sys.argv[1:]
    everything = "--all" in args
    only = {a for a in args if not a.startswith("--")}
    pub, pool = load(INDEX), load(POOL)
    pub_ids = {x["id"] for x in pub}
    have = pub_ids | {x["id"] for x in pool}
    built = {}
    for w in WORKS:
        if only:
            if w["id"] not in only:
                continue
        elif not everything and w["id"] in have:
            continue
        built[w["id"]] = build(w)
    save(INDEX, [built.get(x["id"], x) for x in pub])  # 公開済みは 並びを変えない
    waiting = {x["id"]: x for x in pool}
    waiting.update({k: v for k, v in built.items() if k not in pub_ids})
    save(POOL, [waiting[w["id"]] for w in WORKS if w["id"] in waiting])  # 候補は WORKS の順=公開する順
    print(f"published {len(pub)} / pool {len(waiting)} / fetched {len(built)}")


if __name__ == "__main__":
    main()
