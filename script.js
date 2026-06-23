// ============================================================
//  PDF.js 워커 설정
// ============================================================
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";

// ============================================================
//  전역 상태
// ============================================================
let allStudents   = [];   // 파싱된 전체 학생 데이터
let evalItems     = [];   // 추출된 평가내용 목록 (고유값)
let orderedItems  = [];   // 교사가 순서 변경 후 적용된 목록

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

  if (!file) { alert("📂 PDF 파일을 먼저 업로드해주세요!"); return; }

  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("tableSection").classList.add("hidden");
  document.getElementById("orderSection").classList.add("hidden");
  document.getElementById("downloadSection").classList.add("hidden");
  document.getElementById("welcomeMsg").classList.add("hidden");

  try {
    const text      = await extractPDF(file);
    allStudents     = parseStudents(text, subject);
    evalItems       = extractEvalItems(allStudents);
    orderedItems    = [...evalItems];

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
    alert("PDF 분석 오류: " + e.message);
    console.error(e);
  }
});

// ============================================================
//  PDF에서 텍스트 추출 (좌표 기반 줄 재구성)
// ============================================================
async function extractPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: buffer }).promise;
  let out = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines   = {};

    content.items.forEach(item => {
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push({ x: item.transform[4], str: item.str });
    });

    Object.keys(lines)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach(y => {
        const row = lines[y].sort((a, b) => a.x - b.x).map(i => i.str).join("\t");
        out += row + "\n";
      });
  }
  return out;
}

// ============================================================
//  학생 데이터 파싱
//  나이스 성적표 구조:
//  "반-번호  성명  영역  성취기준코드  평가내용  단계  결과문장"
// ============================================================
function parseStudents(text, subject) {
  const lines   = text.split("\n").map(l => l.trim()).filter(Boolean);
  const result  = [];
  let   current = null;

  lines.forEach(line => {
    const cols = line.split("\t").map(c => c.trim()).filter(Boolean);

    // 학생 헤더 감지: 첫 번째 컬럼이 "숫자-숫자" 또는 "숫자" 형태
    const isHeader = cols[0] && (
      /^\d{1,2}-\d{1,3}$/.test(cols[0]) ||   // 예: 1-05
      /^\d{1,3}$/.test(cols[0])               // 예: 5
    ) && cols[1] && /^[\uAC00-\uD7A3]{2,5}$/.test(cols[1]);

    if (isHeader) {
      current = {
        번호: cols[0],
        이름: cols[1],
        과목: subject,
        evaluations: []
      };
      result.push(current);

      // 같은 줄에 평가 정보가 있을 수 있음
      if (cols.length >= 4) {
        pushEval(current, cols.slice(2));
      }
      return;
    }

    // 평가 행: 현재 학생이 있고, 등급 키워드 포함
    if (current && isEvalLine(line)) {
      pushEval(current, cols);
    }
  });

  return result;
}

// 평가 행 여부 판별
function isEvalLine(line) {
  return /(상|중|하|잘함|보통|노력요함)/.test(line);
}

// 평가 정보를 학생에 추가
function pushEval(student, cols) {
  // 단계 찾기
  const gradeIdx = cols.findIndex(c => /(상|중|하|잘함|보통|노력요함)/.test(c));
  if (gradeIdx === -1) return;

  const rawGrade = cols[gradeIdx];
  const 단계     = normalizeGrade(rawGrade);

  // 성취기준코드 찾기 (대괄호 포함 패턴)
  const achCol   = cols.find(c => /\[/.test(c)) || "";
  const 성취기준 = achCol.match(/\[([^\]]+)\]/)?.[0] || achCol;

  // 평가내용: 성취기준 뒤 ~ 단계 앞 사이 텍스트
  let 평가내용 = "";
  const achIdx = achCol ? cols.indexOf(achCol) : -1;
  if (achIdx !== -1 && gradeIdx > achIdx + 1) {
    평가내용 = cols.slice(achIdx + 1, gradeIdx).join(" ").trim();
  } else if (gradeIdx > 0) {
    평가내용 = cols.slice(0, gradeIdx).join(" ").trim();
  }

  // 영역 (첫 컬럼 중 한글 2자 이상)
  const 영역 = cols.find(c =>
    /^[\uAC00-\uD7A3]{2,6}$/.test(c) &&
    !/(상|중|하|잘함|보통|노력요함)/.test(c)
  ) || "";

  student.evaluations.push({ 영역, 성취기준, 평가내용, 단계 });
}

// 등급 정규화
function normalizeGrade(raw) {
  const r = raw.replace(/\s/g, "");
  if (r === "상" || r === "잘함")      return "잘함";
  if (r === "중" || r === "보통")      return "보통";
  if (r === "하" || r === "노력요함")  return "노력요함";
  return r;
}

// ============================================================
//  평가내용 고유 목록 추출 (전체 학생 기준)
// ============================================================
function extractEvalItems(students) {
  const set = new Set();
  students.forEach(s => s.evaluations.forEach(e => {
    if (e.평가내용) set.add(e.평가내용);
  }));
  return [...set];
}

// ============================================================
//  순서 변경 드롭다운 생성
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
      opt.textContent = item.length > 18 ? item.slice(0, 18) + "…" : item;
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
  const selects     = document.querySelectorAll(".order-select");
  const subject     = document.getElementById("subjectInput").value.trim() || "과목";
  const newOrdered  = [];
  const seen        = new Set();

  selects.forEach(sel => {
    const val = sel.value;
    if (!seen.has(val)) {
      newOrdered.push(val);
      seen.add(val);
    }
  });

  // 선택 안 된 항목은 뒤에 추가
  evalItems.forEach(item => {
    if (!seen.has(item)) newOrdered.push(item);
  });

  orderedItems = newOrdered;
  renderTable(allStudents, orderedItems, subject);
});

// ============================================================
//  표 렌더링 (화면 미리보기)
// ============================================================
function renderTable(students, ordered, subject) {
  const wrap = document.getElementById("tableWrap");

  // 헤더
  let html = `
    <table class="grade-table" id="gradeTable">
      <thead>
        <tr>
          <th class="col-num">번호</th>
          <th class="col-name">이름</th>
          <th class="col-subject">과목</th>
          <th class="col-eval">평가내용</th>
          <th class="col-grade">잘함</th>
          <th class="col-grade">보통</th>
          <th class="col-grade">노력요함</th>
        </tr>
      </thead>
      <tbody>
  `;

  students.forEach((stu, idx) => {
    const rowClass = idx % 2 === 0 ? "row-even" : "row-odd";
    const rowspan  = ordered.length || 1;

    // 평가내용 → 해당 학생의 등급 매핑
    const evalMap = {};
    stu.evaluations.forEach(e => {
      evalMap[e.평가내용] = e.단계;
    });

    ordered.forEach((evalItem, eIdx) => {
      const grade  = evalMap[evalItem] || "";
      const isWell = grade === "잘함"    ? `<span class="circle-mark">○</span>` : "";
      const isNorm = grade === "보통"    ? `<span class="circle-mark">○</span>` : "";
      const isNeed = grade === "노력요함"? `<span class="circle-mark">○</span>` : "";

      if (eIdx === 0) {
        // 첫 행: 번호·이름·과목 셀 병합
        html += `
          <tr class="${rowClass}">
            <td rowspan="${rowspan}" class="cell-merge col-num">${stu.번호}</td>
            <td rowspan="${rowspan}" class="cell-merge col-name">${stu.이름}</td>
            <td rowspan="${rowspan}" class="cell-merge col-subject">${subject}</td>
            <td class="col-eval">${evalItem}</td>
            <td class="col-grade">${isWell}</td>
            <td class="col-grade">${isNorm}</td>
            <td class="col-grade">${isNeed}</td>
          </tr>
        `;
      } else {
        // 나머지 행: 평가내용·등급만
        html += `
          <tr class="${rowClass}">
            <td class="col-eval">${evalItem}</td>
            <td class="col-grade">${isWell}</td>
            <td class="col-grade">${isNorm}</td>
            <td class="col-grade">${isNeed}</td>
          </tr>
        `;
      }
    });
  });

  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

// ============================================================
//  HWPX 생성 및 다운로드
//  HWPX = ZIP 컨테이너 + XML 본문
// ============================================================
document.getElementById("downloadBtn").addEventListener("click", async () => {
  if (!allStudents.length) { alert("먼저 PDF를 분석해주세요."); return; }

  const subject = document.getElementById("subjectInput").value.trim() || "과목";
  const zip     = new JSZip();

  // mimetype
  zip.file("mimetype", "application/hwp+zip");

  // META-INF/container.xml
  zip.folder("META-INF").file("container.xml", containerXml());

  // Contents/content.hpf
  zip.folder("Contents").file("content.hpf", contentHpf());

  // Contents/section0.xml (본문 표)
  const sectionXml = buildSectionXml(allStudents, orderedItems, subject);
  zip.folder("Contents").file("section0.xml", sectionXml);

  const blob = await zip.generateAsync({ type: "blob" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${subject}_성적분석표.hwpx`;
  a.click();
  URL.revokeObjectURL(url);
});

// HWPX 규격 XML 생성 함수들
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

// 셀 XML 생성
function cell(text, width, bold = false, rowspan = 1, halign = "center") {
  const bVal  = bold ? "true" : "false";
  const rsAttr = rowspan > 1 ? ` hp:rowSpan="${rowspan}"` : "";
  return `
    <hp:tc${rsAttr}>
      <hp:tcPr>
        <hp:cellSpan hp:colSpan="1" hp:rowSpan="${rowspan}"/>
        <hp:width hp:type="dxa" hp:w="${width}"/>
        <hp:tcBdr>
          <hp:top    hp:type="single" hp:sz="4" hp:color="000000"/>
          <hp:bottom hp:type="single" hp:sz="4" hp:color="000000"/>
          <hp:left   hp:type="single" hp:sz="4" hp:color="000000"/>
          <hp:right  hp:type="single" hp:sz="4" hp:color="000000"/>
        </hp:tcBdr>
        <hp:shd hp:val="clear" hp:color="auto" hp:fill="FFFFFF"/>
      </hp:tcPr>
      <hp:p>
        <hp:pPr><hp:jc hp:val="${halign}"/></hp:pPr>
        <hp:r>
          <hp:rPr>
            <hp:b hp:val="${bVal}"/>
            <hp:sz hp:val="18"/>
            <hp:szCs hp:val="18"/>
          </hp:rPr>
          <hp:t>${escXml(text)}</hp:t>
        </hp:r>
      </hp:p>
    </hp:tc>`;
}

// XML 특수문자 이스케이프
function escXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 본문 section0.xml 생성
function buildSectionXml(students, ordered, subject) {
  let rows = "";

  // ── 헤더 행 ──
  rows += `<hp:tr>
    ${cell("번호",   700, true)}
    ${cell("이름",   1100, true)}
    ${cell("과목",   900, true)}
    ${cell("평가내용", 3500, true)}
    ${cell("잘함",   900, true)}
    ${cell("보통",   900, true)}
    ${cell("노력요함",1100, true)}
  </hp:tr>`;

  // ── 학생 행 ──
  students.forEach(stu => {
    const rs      = ordered.length || 1;
    const evalMap = {};
    stu.evaluations.forEach(e => { evalMap[e.평가내용] = e.단계; });

    ordered.forEach((evalItem, eIdx) => {
      const grade = evalMap[evalItem] || "";
      const well  = grade === "잘함"     ? "○" : "";
      const norm  = grade === "보통"     ? "○" : "";
      const need  = grade === "노력요함" ? "○" : "";

      if (eIdx === 0) {
        rows += `<hp:tr>
          ${cell(stu.번호,   700,  true, rs)}
          ${cell(stu.이름,   1100, true, rs)}
          ${cell(subject,    900,  true, rs)}
          ${cell(evalItem,  3500, false, 1, "left")}
          ${cell(well,       900)}
          ${cell(norm,       900)}
          ${cell(need,      1100)}
        </hp:tr>`;
      } else {
        rows += `<hp:tr>
          ${cell(evalItem, 3500, false, 1, "left")}
          ${cell(well,      900)}
          ${cell(norm,      900)}
          ${cell(need,     1100)}
        </hp:tr>`;
      }
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="urn:com:hancom:hwpml:2011:paragraph"
        xmlns:hc="urn:com:hancom:hwpml:2011:core">
  <hp:p>
    <hp:r><hp:t>${escXml(subject)} 성적 분석표</hp:t></hp:r>
  </hp:p>
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
