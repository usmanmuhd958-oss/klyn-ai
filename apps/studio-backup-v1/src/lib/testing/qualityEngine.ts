
import type {
QualityScore,
GeneratedTest
} from "@/components/testing/testing.types";


export function calculateQuality(
 tests:GeneratedTest[]
):QualityScore {

const coverage =
 Math.min(100,tests.length * 20);

const reliability =
 tests.every(t=>t.confidence>80)
 ? 95
 : 70;


return {

coverage,

reliability,

security:90,

maintainability:92,

overall:
 Math.round(
 (
 coverage+
 reliability+
 90+
 92
 )/4
 )

};

}

