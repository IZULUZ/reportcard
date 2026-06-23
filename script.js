// =====================================================
//  PDF.js 설정: 워커 경로 지정 (CDN 사용)
// =====================================================
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.worker.min.js";


// =====================================================
//  전역 변수: 분석된 학생 데이터 저장
// =====================================================
let parsedStudents = [];


// =====================================================
//  파일 이름 표시
// =====================================================
document.getElementById("pdfInput").addEventListener("change", function () {
  const name = this.files[0]?.name || "";
  document.getElementById("fileName").textContent = name ? `선택된 파일: ${name}` : "";
});


// =====================================================
//  분석 시작 버튼 클릭
// =====================================================
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const file = document.getElementById("pdfInput").files[0];

  if (!file) {
    alert("📂 PDF 파일을 먼저 업로드해주세요!");
    return;
  }

  // 로딩 표시
  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("resultSection").classList.add("hidden");

  try {
    const text = await extractTextFromPDF(file);
    parsedStudents = parseStudentsFromText(text);

    renderPreviewTable(parsedStudents);

    document.getElementById("loading").classList.add("hidden");
    document.getElementById("resultSection").classList.remove("hidden");

  } catch (err) {
    document.getElementById("loading").classList.add("hidden");
    alert("PDF 분석 중 오류가 발생했습니다. 파일을 확인해주세요.\n" + err.message);
    console.error(err);
  }
});


// =====================================================
//  PDF 텍스트 추출 함수
// =====================================================
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // 텍스트 아이템을 x,y 좌표 기반으로 줄 단위로 재구성
    const items = content.items;
    const lines = {};

    items.forEach(item => {
      // y좌표를 반올림해서 같은 줄로 묶음
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push({ x: item.transform[4], text: item.str });
    });

    // y좌표 내림차순(위에서 아래로) 정렬 후 x좌표 오름차순(왼쪽에서 오른쪽)
    const sortedYs = Object.keys(lines).map(Number).sort((a, b) => b - a);

    sortedYs.forEach(y => {
      const lineItems = lines[y].sort((a, b) => a.x - b.x);
      const lineText = lineItems.map(i => i.text).join(" ").trim();
      if (lineText) fullText += lineText + "\n";
    });
  }

  return fullText;
}


// =====================================================
//  텍스트에서 학생 데이터 파싱
// =====================================================
function parseStudentsFromText(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const students = [];

  // 나이스 성적표 기준:
  // "반-번호 이름" 패턴을 찾아 학생 단위로 분리
  // 예: "1-1 홍길동"  또는  "01 홍길동"

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 번호+이름 패턴 탐지: 숫자-숫자 또는 숫자 + 이름(한글)
    const studentHeader = line.match(
      /^(\d{1,2}[-\/]?\d{1,2})\s+([\uAC00-\uD7A3]{2,5})/
    );

    if (studentHeader) {
      const 번호 = studentHeader[1];
      const 이름 = studentHeader[2];

      // 이 학생의 평가 행들 수집
      const evaluations = [];
      i++;

      while (i < lines.length) {
        // 다음 학생 시작이면 루프 종료
        if (lines[i].match(/^(\d{1,2}[-\/]?\d{1,2})\s+([\uAC00-\uD7A3]{2,5})/)) break;

        // 평가 행 패턴:
        // "영역 / 성취기준코드 / 평가내용 / 단계 / 결과" 형태
        const evalLine = lines[i];

        // 성취기준 코드 포함 여부로 평가 행 판별
        const hasAchCode = evalLine.match(/\[[\uAC00-\uD7A3\d]{4,}\]/);

        // 단계(상/중/하 또는 잘함/보통/노력요함) 포함 여부
        const hasGrade = evalLine.match(/(상|중|하|잘\s*함|보\s*통|노력\s*요\s*함)/);

        if (hasGrade || hasAchCode) {
          evaluations.push(evalLine);
        }

        i++;
      }

      // 평가 행 데이터 구조화
      evaluations.forEach(ev => {
        const parts = ev.split(/\s{2,}|\t/).filter(Boolean);

        // 단계 추출
        const gradeMatch = ev.match(/(상|중|하|잘\s*함|보\s*통|노력\s*요\s*함)/);
        const raw단계 = gradeMatch ? gradeMatch[0].replace(/\s/g, "") : "";

        // 잘함/보통/노력요함 으로 통일
        const 단계 = normalize단계(raw단계);

        // 성취기준 코드 추출
        const achMatch = ev.match(/\[([^\]]+)\]/);
        const 성취기준 = achMatch ? `[${achMatch[1]}]` : (parts[1] || "");

        // 평가내용: 성취기준 뒤, 단계 앞 부분
        let 평가내용 = "";
        if (achMatch) {
          const afterAch = ev.slice(ev.indexOf(achMatch[0]) + achMatch[0].length);
          평가내용 = afterAch.replace(/(상|중|하|잘\s*함|보\s*통|노력\s*요\s*함).*/, "").trim();
        } else {
          평가내용 = parts[2] || "";
        }

        // 영역
        const 영역 = parts[0]?.replace(/\[.*\]/, "").trim() || "";

        students.push({
          번호,
          이름,
          영역,
          성취기준,
          평가내용,
          단계
        });
      });

    } else {
      i++;
    }
  }

  return students;
}


// =====================================================
//  등급 정규화: 상/중/하 → 잘함/보통/노력요함
// =====================================================
function normalize단계(raw) {
  if (raw === "상" || raw === "잘함") return "잘함";
  if (raw === "중" || raw === "보통") return "보통";
  if (raw === "하" || raw === "노력요함") return "노력요함";
  return raw;
}


// =====================================================
//  화면 미리보기 표 렌더링
// =====================================================
function renderPreviewTable(students) {
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  if (students.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:#888; padding:20px;">
      분석된 데이터가 없습니다. PDF 구조를 확인해주세요.
    </td></tr>`;
    return;
  }

  students.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.번호}</td>
      <td>${s.이름}</td>
      <td>${s.영역}</td>
      <td>${s.성취기준}</td>
      <td>${s.평가내용}</td>
      <td class="circle">${s.단계 === "잘함" ? "◯" : ""}</td>
      <td class="circle">${s.단계 === "보통" ? "◯" : ""}</td>
      <td class="circle">${s.단계 === "노력요함" ? "◯" : ""}</td>
    `;
    tbody.appendChild(tr);
  });
}


// =====================================================
//  한글 파일(HWPX) 생성 및 다운로드
//  HWPX = ZIP 안에 XML 파일들이 들어있는 구조
// =====================================================
document.getElementById("downloadBtn").addEventListener("click", () => {
  if (parsedStudents.length === 0) {
    alert("분석된 데이터가 없습니다.");
    return;
  }

  generateHWPX(parsedStudents);
});


async function generateHWPX(students) {
  const zip = new JSZip();

  // --- mimetype (HWPX 규격 필수) ---
  zip.file("mimetype", "application/hwp+zip");

  // --- META-INF/container.xml ---
  zip.folder("META-INF").file("container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container>
  <rootfiles>
    <rootfile full-path="Contents/content.hpf" media-type="application/hwp+zip"/>
  </rootfiles>
</container>`);

  // --- Contents/content.hpf ---
  zip.folder("Contents").file("content.hpf", `<?xml version="1.0" encoding="UTF-8"?>
<Package version="1.0">
  <Metadata/>
  <Manifest>
    <item id="content" href="section0.xml" media-type="application/xml"/>
  </Manifest>
  <Spine>
    <itemref idref="content"/>
  </Spine>
</Package>`);

  // --- 표 행 생성 함수 ---
  function makeCell(text, width = 1800, isHeader = false) {
    return `
      <hp:tc>
        <hp:tcPr>
          <hp:tcBdr>
            <hp:top hp:type="single" hp:width="1" hp:color="000000"/>
            <hp:right hp:type="single" hp:width="1" hp:color="000000"/>
            <hp:bottom hp:type="single" hp:width="1" hp:color="000000"/>
            <hp:left hp:type="single" hp:width="1" hp:color="000000"/>
          </hp:tcBdr>
          <hp:width hp:type="dxa" w:w="${width}"/>
        </hp:tcPr>
        <hp:p>
          <hp:pPr>
            <hp:jc hp:val="center"/>
          </hp:pPr>
          <hp:r>
            <hp:rPr>
              <hp:b hp:val="${isHeader}"/>
              <hp:sz hp:val="18"/>
            </hp:rPr>
            <hp:t>${text}</hp:t>
          </hp:r>
        </hp:p>
      </hp:tc>`;
  }

  // --- 헤더 행 생성 ---
  const headerRow = `
    <hp:tr>
      ${makeCell("번호", 800, true)}
      ${makeCell("이름", 1000, true)}
      ${makeCell("영역", 1200, true)}
      ${makeCell("성취기준", 2500, true)}
      ${makeCell("평가내용", 3000, true)}
      ${makeCell("잘함", 800, true)}
      ${makeCell("보통", 800, true)}
      ${makeCell("노력요함", 1000, true)}
    </hp:tr>`;

  // --- 학생 데이터 행 생성 ---
  const dataRows = students.map(s => `
    <hp:tr>
      ${makeCell(s.번호, 800)}
      ${makeCell(s.이름, 1000)}
      ${makeCell(s.영역, 1200)}
      ${makeCell(s.성취기준, 2500)}
      ${makeCell(s.평가내용, 3000)}
      ${makeCell(s.단계 === "잘함" ? "◯" : "", 800)}
      ${makeCell(s.단계 === "보통" ? "◯" : "", 800)}
      ${makeCell(s.단계 === "노력요함" ? "◯" : "", 1000)}
    </hp:tr>`).join("");

  // --- section0.xml (본문 XML) ---
  const sectionXml = `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="urn:com:hancom:hwpml:2011:paragraph">
  <hp:p>
    <hp:r>
      <hp:t>성적 분석 결과</hp:t>
    </hp:r>
  </hp:p>
  <hp:tbl hp:id="1">
    <hp:tblPr>
      <hp:tblBdr>
        <hp:insideH hp:val="single" hp:sz="1" hp:color="000000"/>
        <hp:insideV hp:val="single" hp:sz="1" hp:color="000000"/>
      </hp:tblBdr>
    </hp:tblPr>
    ${headerRow}
    ${dataRows}
  </hp:tbl>
</hp:sec>`;

  zip.folder("Contents").file("section0.xml", sectionXml);

  // --- ZIP 생성 및 다운로드 ---
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "성적분석표.hwpx";
  a.click();

  URL.revokeObjectURL(url);
}
