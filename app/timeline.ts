// 지난 일을 그림으로 그리기 위한 자료 모양. 이름으로만 가리킨다(색도 이름으로 찾는다).
export type Ballot = { by: string; to: string | null }; // to가 null이면 기권
export type Step =
  | { kind: "dead" | "out" | "mayor"; who: string; reveal?: string }
  | { kind: "votes"; ballots: Ballot[]; tally: Record<string, number> }
  | { kind: "point"; by: string; who: string } // 밀고자가 아침에 지목했다
  | { kind: "go"; by: string; role: string | null; to: string | null; off: boolean; fake: boolean; title: string } // role이 null이면 살해
  | { kind: "hit"; by: string; to: string; died: boolean; title: string }
  | { kind: "text"; text: string };
export type Period = { night: boolean; label: string; steps: Step[] };

// ponytail: 진행 중에는 서버가 글 소식만 주므로 game.ts의 문구를 정규식으로 읽는다.
// 문구가 바뀌거나 닉네임에 ", "·"→"가 들어가면 그 줄은 글 그대로 나온다. view에 구조화된 소식이 생기면 그걸로 바꾼다.
export function periodsOf(lines: string[]): Period[] {
  const out: Period[] = [];
  const at = (night: boolean, label: string) => {
    const last = out[out.length - 1];
    if (last?.label === label) return last;
    const made: Period = { night, label, steps: [] };
    out.push(made);
    return made;
  };
  const cur = () => out[out.length - 1] ?? at(false, "시작");
  const ballots = (s: string): Ballot[] =>
    s.split(", ").map((b) => {
      const [by, to] = b.split("→");
      return { by, to: !to || to === "기권" ? null : to };
    });
  for (const line of lines) {
    let m: RegExpMatchArray | null;
    if (line.startsWith("게임을 시작합니다") || line.startsWith("역할이 정해졌습니다")) continue;
    if ((m = line.match(/^(\d+일차 밤): (.+) 님이 사망했습니다\. \((.+)\)$/))) at(true, m[1]).steps.push({ kind: "dead", who: m[2], reveal: m[3] });
    else if ((m = line.match(/^(\d+일차 밤): (.+) 님이 (.+) 님을 지목했습니다\.$/))) at(true, m[1]).steps.push({ kind: "point", by: m[2], who: m[3] });
    else if ((m = line.match(/^(\d+일차 밤): 아무도 죽지 않았습니다\.$/))) at(true, m[1]).steps.push({ kind: "text", text: "조용했다" });
    else if ((m = line.match(/^시장 선거: (.+)$/))) at(false, "시장 선거").steps.push({ kind: "votes", ballots: ballots(m[1]), tally: {} });
    else if ((m = line.match(/^(\d+일차) 투표: (.+)$/))) at(false, `${m[1]} 낮`).steps.push({ kind: "votes", ballots: ballots(m[2]), tally: {} });
    else if ((m = line.match(/^득표: (.+)$/))) {
      const votes = cur().steps.filter((s) => s.kind === "votes").pop();
      for (const t of m[1].split(", ")) {
        const k = t.match(/^(.+) ([\d.]+)표$/);
        if (votes && k) votes.tally[k[1]] = Number(k[2]);
      }
    } else if ((m = line.match(/^(.+) 님이 추방당했습니다\. \((.+)\)$/))) cur().steps.push({ kind: "out", who: m[1], reveal: m[2] });
    else if ((m = line.match(/^(.+) 님이 시장이 되었습니다/))) cur().steps.push({ kind: "mayor", who: m[1] });
    else if (line.startsWith("시장이 뽑히지")) cur().steps.push({ kind: "text", text: "시장 없음" });
    else if (line.startsWith("과반을 얻은")) cur().steps.push({ kind: "text", text: "추방 없음" });
    else cur().steps.push({ kind: "text", text: line });
  }
  return out;
}
