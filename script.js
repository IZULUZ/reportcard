// ============================================================
//  PDF.js 워커
// ============================================================
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

// ============================================================
//  전역 상태
// ============================================================
let allStudents  = [];
let evalItems    = [];
let orderedItems = [];
let rawPdfText   = "";   // 디버그용 원본 텍스트

// ============================================================
//  파일명 표시
// ============================================================
document.getElementById("pdfInput").addEventListener("change", function () {
  const el = document.getElementById("fileName");
  if (this.files[0]) {
    el.textContent = "📄 " + this.files[0].name;
    el.classList.remove("hidden");
  }
});

// ============================================================
//  [분석 시작] 버튼
// ============================================================
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const file    = document.getElementById("pdfInput").files[0];
  const subject = document.getElementById("subjectInput").value.trim() || "과목";

  if (!file) {
    alert("📂 PDF 파일을 먼저 업로드해주세요!");
    return;
  }

  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("tableSection").classList.add("hidden");
  document.getElementById("orderSection").classList.add("hidden");
  document.getElementById("downloadSection").classList.add("hidden");
  document.getElementById("debugPanel").classList.add("hidden");
  document.getElementById("welcomeMsg").classList.add("hidden");

  try {
    // 1) PDF 텍스트 추출
    rawPdfText = await extractPDF(file);

    // 디버그 버튼 활성화
    document.getElementById("debugBtn").classList.remove("hidden");

    // 2) 파싱 시도
    allStudents = parseStudents(rawPdfText, subject);

    // 3) 결과 없으면 에러 안내
    if (allStudents.length === 0) {
      showParseError();
      document.getElementById("loading").classList.add("hidden");
      return;
    }

    // 4) 평가내용 목록 추출
    evalItems    = extractEvalItems(allStudents);
    orderedItems = [...evalItems];

    buildOrderControls(evalItems);
    renderTable(allStudents, orderedItems, subject);

    document.getElementById("loading").classList.add("hidden");
    document.getElementById("tableSection").classList.remove("hidden");
    document.getElementById("orderSection").classList.remove("hidden");
    document.getElementById("downloadSection").classList.remove("hidden");
    document.getElementById("tableTitle").textContent =
      `${subject} 성적표 — 총 ${allStudents.length}명`;

  } catch (e) {
    document.getElementById("loading").classList.add("hidden");
    showParseError(e.message);
    console.error(e);
  }
});

// ============================================================
//  파싱 실패 안내
// ============================================================
function showParseError(msg = "") {
  const main = document.querySelector(".main");
  const old  = document.getElementById("errorBox");
  if (old) old.remove();

  const div  = document.createElement("div");
  div.id     = "errorBox";
  div.className = "error-box";
  div.innerHTML = `
    <strong>⚠️ PDF 분석에 실패했습니다.</strong><br><br>
    가능한 원인:<br>
    1. PDF가 <b>이미지 스캔본</b>인 경우 (텍스트 추출 불가)<br>
    2. 나이스 성적표 형식이 예상과 다른 경우<br>
    3. PDF 보안 설정으로 텍스트 복사가 차단된 경우<br><br>
    👉 <b>아래 '추출 텍스트 확인' 버튼</b>을 눌러서<br>
    추출된 내용을 선생님이 직접 확인해주세요!<br>
    그 내용을 저(AI)에게 보내주시면 즉시 파싱 로직을 수정해드려요.<br>
    ${msg ? `<br><small style="color:#888">${msg}</small>` : ""}
  `;
  main.prepend(div);
}

// ============================================================
//  디버그: 추출 텍스트 보기
// ============================================================
document.getElementById("debugBtn").addEventListener("click", () => {
  const panel = document.getElementById("debugPanel");
  document.getElementById("debugText").textContent =
    rawPdfText || "(추출된 텍스트 없음)";
  panel.classList.remove("hidden");
});

document.getElementById("closeDebug").addEventListener("click", () => {
  document.getElementById("debugPanel").classList.add("hidden");
});

// ============================================================
//  PDF 텍스트 추출 (좌표 기반 줄 재구성)
// ============================================================
async function extractPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
  let   out    = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lineMap = {};

    content.items.forEach(item => {
      // y좌표 기준으로 같은 줄 묶기
      const y = Math.round(item.transform[5]);
      if (!lineMap[y]) lineMap[y] = [];
      lineMap[y].push({ x: item.transform[4], str: item.str });
    });

    // 위에서 아래로 정렬 후 왼쪽에서 오른쪽으로
    Object.keys(lineMap)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach(y => {
        const sorted = lineMap[y]
          .sort((a, b) => a.x - b.x)
          .map(i => i.str)
          .join("\t");
        if (sorted.trim()) out += sorted + "\n";
      });

    out += "---PAGE---\n";
  }
  return out;
}

// ============================================================
//  핵심 파싱 함수 (다중 패턴 지원)
// ============================================================
function parseStudents(text, subject) {
  const lines  = text.split("\n").map(l => l.trim()).filter(Boolean);
  const result = [];
  let   cur    = null;

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split("\t").map(c => c.trim()).filter(Boolean);
    if (!cols.length) continue;

    // ── 학생 헤더 감지 ──────────────────────────────────
    // 나이스 성적표 패턴들:
    // 패턴A: "1-05  홍길동"  (반-번호 이름)
    // 패턴B: "5  홍길동"     (번호 이름)
    // 패턴C: "05  홍길동"    (두자리 번호 이름)
    const numPart  = cols[0];
    const namePart = cols[1];

    const isNum  = /^\d{1,2}$/.test(numPart) ||
                   /^\d{1,2}[-\/]\d{1,3}$/.test(numPart);
    const isName = namePart &&
                   /^[\uAC00-\uD7A3]{2,5}$/.test(namePart);

    if (isNum && isName) {
      cur = {
        번호: numPart,
        이름: namePart,
        과목: subject,
        evaluations: []
      };
      result.push(cur);

      // 같은 줄에 평가 정보도 있을 수 있음
      if (cols.length >= 4) {
        tryAddEval(cur, cols.slice(2));
      }
      continue;
    }

    // ── 평가 행 감지 ────────────────────────────────────
    if (cur && hasGradeKeyword(lines[i])) {
      tryAddEval(cur, cols);
    }
  }

  return result;
}

// 등급 키워드 포함 여부
function hasGradeKeyword(line) {
  return /(상|중|하|잘\s*함|보\s*통|노력\s*요\s*함)/.test(line);
}

// 평가 정보 추가
function tryAddEval(student, cols) {
  // 등급 위치 찾기
  const gradeIdx = cols.findIndex(c =>
    /(상|중|하|잘\s*함|보\s*통|노력\s*요\s*함)/.test(c)
  );
  if (gradeIdx === -1) return;

  const rawGrade = cols[gradeIdx];
  const 단계     = normalizeGrade(rawGrade);

  // 성취기준코드 (대괄호 패턴)
  const achCol   = cols.find(c => /\[/.test(c)) || "";
  const 성취기준 = achCol.match(/\[([^\]]+)\]/)?.[0] || achCol;

  // 평가내용 추출: 성취기준 이후 ~ 단계 이전
  let 평가내용 = "";
  const achIdx = achCol ? cols.indexOf(achCol) : -1;

  if (achIdx !== -1 && gradeIdx > achIdx + 1) {
    평가내용 = cols.slice(achIdx + 1, gradeIdx).join(" ").trim();
  } else if (gradeIdx > 1) {
    // 번호/이름 없이 평가내용만 있는 행
    평가내용 = cols.slice(0, gradeIdx).join(" ").trim();
  } else if (gradeIdx === 1 && cols[0]) {
    평가내용 = cols[0];
  }

  // 영역 추출 (짧은 한글 단어)
  const 영역 = cols.find(c =>
    /^[\uAC00-\uD7A3]{2,6}$/.test(c) &&
    !/(상|중|하|잘함|보통|노력요함)/.test(c) &&
    c !== student.이름
  ) || "";

  if (평가내용) {
    student.evaluations.push({ 영역, 성취기준, 평가내용, 단계 });
  }
}

// 등급 정규화
function normalizeGrade(raw) {
  const r = raw.replace(/\s/g, "");
  if (r === "상" || r === "잘함")     return "잘함";
  if (r === "중" || r === "보통")     return "보통";
  if (r === "하" || r === "노력요함") return "노력요함";
  return r;
}

// ============================================================
//  평가내용 고유 목록 추출
// ============================================================
function extractEvalItems(students) {
  const set = new Set();
  students.forEach(s =>
    s.evaluations.forEach(e => { if (e.평가내용) set.add(e.평가내용); })
  );
  return [...set];
}

// ============================================================
//  순서 변경 드롭다운
// ============================================================
function buildOrderControls(items) {
  const wrap = document.getElementById("orderControls");
  wrap.innerHTML = "";

  items.forEach((_, i) => {
    const row = document.createElement("div");
    row.className = "order-row";

    const num = document.createElement("div");
    num.className = "order-num";
    num.textContent = i + 1;

    const sel = document.createElement("select");
    sel.className = "order-select";
    sel.dataset.pos = i;

    items.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item;
      opt.textContent = item.length > 16
        ? item.slice(0, 16) + "…" : item;
      if (item === items[i]) opt.selected = true;
      sel.appendChild(opt);
    });

    row.appendChild(num);
    row.appendChild(sel);
    wrap.appendChild(row);
  });
}

// ============================================================
//  [순서 적용] 버튼
// ============================================================
document.getElementById("applyOrderBtn").addEventListener("click", () => {
  const subject  = document.getElementById("subjectInput").value.trim() || "과목";
  const selects  = document.querySelectorAll(".order-select");
  const newOrder = [];
  const seen     = new Set();

  selects.forEach(sel => {
    if (!seen.has(sel.value)) {
      newOrder.push(sel.value);
      seen.add(sel.value);
    }
  });

  evalItems.forEach(item => {
    if (!seen.has(item)) newOrder.push(item);
  });

  orderedItems = newOrder;
  renderTable(allStudents, orderedItems, subject);
});

// ============================================================
//  표 렌더링
// ============================================================
function renderTable(students, ordered, subject) {
  const wrap = document.getElementById("tableWrap");
  let html = `
    <table class="grade-table">
      <thead>
        <tr>
          <th class="col-num">번호</th>
          <th class="col-name">이름</th>
          <th class="col-subj">과목</th>
          <th class="col-eval">평가내용</th>
          <th class="col-grade">잘함</th>
          <th class="col-grade">보통</th>
          <th class="col-grade">노력요함</th>
        </tr>
      </thead>
      <tbody>
  `;

  students.forEach((stu, idx) => {
    const rc  = idx % 2 === 0 ? "row-even" : "row-odd";
    const rs  = ordered.length || 1;
    const map = {};
    stu.evaluations.forEach(e => { map[e.평가내용] = e.단계; });

    ordered.forEach((item, eIdx) => {
      const grade = map[item] || "";
      const c잘함  = grade === "잘함"     ? `<span class="circle-mark">○</span>` : "";
      const c보통  = grade === "보통"     ? `<span class="circle-mark">○</span>` : "";
      const c노력  = grade === "노력요함" ? `<span class="circle-mark">○</span>` : "";

      if (eIdx === 0) {
        html += `<tr class="${rc}">
          <td rowspan="${rs}" class="cell-merge col-num">${stu.번호}</td>
          <td rowspan="${rs}" class="cell-merge col-name">${stu.이름}</td>
          <td rowspan="${rs}" class="cell-merge col-subj">${subject}</td>
          <td class="col-eval">${item}</td>
          <td class="col-grade">${c잘함}</td>
          <td class="col-grade">${c보통}</td>
          <td class="col-grade">${c노력}</td>
        </tr>`;
      } else {
        html += `<tr class="${rc}">
          <td class="col-eval">${item}</td>
          <td class="col-grade">${c잘함}</td>
          <td class="col-grade">${c보통}</td>
          <td class="col-grade">${c노력}</td>
        </tr>`;
      }
    });
  });

  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

// ============================================================
//  HWPX 다운로드
// ============================================================
document.getElementById("downloadBtn").addEventListener("click", async () => {
  if (!allStudents.length) { alert("먼저 PDF를 분석해주세요."); return; }
  const subject = document.getElementById("subjectInput").value.trim() || "과목";
  const zip = new JSZip();

  zip.file("mimetype", "application/hwp+zip");
  zip.folder("META-INF").file("container.xml", containerXml());
  zip.folder("Contents").file("content.hpf", contentHpf());
  zip.folder("Contents").file("section0.xml",
    buildSectionXml(allStudents, orderedItems, subject));

  const blob = await zip.generateAsync({ type: "blob" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${subject}_성적분석표.hwpx`;
  a.click();
  URL.revokeObjectURL(url);
});

function containerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="Contents/content.hpf"
              media-type="application/hwp+zip"/>
  </rootfiles>
</container>`;
}

function contentHpf() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="1.0">
  <opf:manifest>
    <opf:item id="section0" href="section0.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0"/>
  </opf:spine>
</opf:package>`;
}

function escXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(text, w, bold = false, rs = 1, align = "center") {
  const b   = bold ? "true" : "false";
  const rsa = rs > 1 ? ` hp:rowSpan="${rs}"` : "";
  return `
    <hp:tc${rsa}>
      <hp:tcPr>
        <hp:cellSpan hp:colSpan="1" hp:rowSpan="${rs}"/>
        <hp:width hp:type="dxa" hp:w="${w}"/>
        <hp:tcBdr>
          <hp:top    hp:type="single" hp:sz="4" hp:color="000000"/>
          <hp:bottom hp:type="single" hp:sz="4" hp:color="000000"/>
          <hp:left   hp:type="single" hp:sz="4" hp:color="000000"/>
          <hp:right  hp:type="single" hp:sz="4" hp:color="000000"/>
        </hp:tcBdr>
      </hp:tcPr>
      <hp:p>
        <hp:pPr><hp:jc hp:val="${align}"/></hp:pPr>
        <hp:r>
          <hp:rPr>
            <hp:b hp:val="${b}"/>
            <hp:sz hp:val="18"/>
          </hp:rPr>
          <hp:t>${escXml(text)}</hp:t>
        </hp:r>
      </hp:p>
    </hp:tc>`;
}

function buildSectionXml(students, ordered, subject) {
  let rows = `<hp:tr>
    ${cell("번호",   700, true)}
    ${cell("이름",  1100, true)}
    ${cell("과목",   900, true)}
    ${cell("평가내용", 3500, true)}
    ${cell("잘함",   900, true)}
    ${cell("보통",   900, true)}
    ${cell("노력요함",1200,true)}
  </hp:tr>`;

  students.forEach(stu => {
    const rs  = ordered.length || 1;
    const map = {};
    stu.evaluations.forEach(e => { map[e.평가내용] = e.단계; });

    ordered.forEach((item, eIdx) => {
      const g   = map[item] || "";
      const c잘  = g === "잘함"     ? "○" : "";
      const c보  = g === "보통"     ? "○" : "";
      const c노  = g === "노력요함" ? "○" : "";

      if (eIdx === 0) {
        rows += `<hp:tr>
          ${cell(stu.번호,   700,  true, rs)}
          ${cell(stu.이름,  1100,  true, rs)}
          ${cell(subject,    900,  true, rs)}
          ${cell(item,      3500, false,  1, "left")}
          ${cell(c잘,        900)}
          ${cell(c보,        900)}
          ${cell(c노,       1200)}
        </hp:tr>`;
      } else {
        rows += `<hp:tr>
          ${cell(item, 3500, false, 1, "left")}
          ${cell(c잘,   900)}
          ${cell(c보,   900)}
          ${cell(c노,  1200)}
        </hp:tr>`;
      }
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="urn:com:hancom:hwpml:2011:paragraph">
  <hp:p><hp:r><hp:t>${escXml(subject)} 성적 분석표</hp:t></hp:r></hp:p>
  <hp:tbl hp:id="1">
    <hp:tblPr>
      <hp:tblBdr>
        <hp:insideH hp:val="single" hp:sz="4" hp:color="000000"/>
        <hp:insideV hp:val="single" hp:sz="4" hp:color="000000"/>
      </hp:tblBdr>
    </hp:tblPr>
    ${rows}
  </hp:tbl>
</hp:sec>`;
}
