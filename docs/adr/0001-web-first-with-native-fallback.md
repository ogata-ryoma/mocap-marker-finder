# カメラアプリを Web（PWA）で作り、ネイティブは破綻したときの退避先にする

開発機は Windows で Mac が無く、iOS ネイティブはクラウドビルドと Apple Developer 登録（年 99 ドル）が要る。iOS Safari の getUserMedia で torch（LED）が制御できることを実機で確認し、zoom も WebKit のソース（MediaTrackSupportedConstraints）で対応を確認したため、Web で作る。Web に無いのは手動露出だけで、明るい部屋では torch を点滅させて環境光を差分で打ち消す方式で補う。この方式が明るい部屋で破綻した場合に限り、露出制御のあるネイティブ（Expo または Flutter のクラウドビルド）へ移る。検出ロジックは両者で共通なので、移行時に捨てるのは UI 層だけ。

## Considered Options

- ネイティブ先行: 露出制御が使えるが、配布に Apple Developer 登録と TestFlight が固定費として乗る
- Web 先行（採用）: 配布は URL 共有だけ。露出制御が無い点は差分方式で補う
